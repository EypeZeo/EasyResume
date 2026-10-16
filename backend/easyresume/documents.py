"""Bounded document extraction in a disposable process; no document execution."""

import io
import multiprocessing as mp
import os
import time
import zipfile

import psutil

MAX_FILE = 20 * 1024 * 1024
MAX_MEMORY = 512 * 1024 * 1024


def _memory_limit():
    if os.name != "nt":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY, MAX_MEMORY))
        return None
    import ctypes
    from ctypes import wintypes

    class Basic(ctypes.Structure):
        _fields_ = [
            ("process_time", ctypes.c_longlong),
            ("job_time", ctypes.c_longlong),
            ("flags", wintypes.DWORD),
            ("min_ws", ctypes.c_size_t),
            ("max_ws", ctypes.c_size_t),
            ("active", wintypes.DWORD),
            ("affinity", ctypes.c_size_t),
            ("priority", wintypes.DWORD),
            ("scheduling", wintypes.DWORD),
        ]

    class Counters(ctypes.Structure):
        _fields_ = [(f"v{i}", ctypes.c_ulonglong) for i in range(6)]

    class Extended(ctypes.Structure):
        _fields_ = [
            ("basic", Basic),
            ("io", Counters),
            ("process_memory", ctypes.c_size_t),
            ("job_memory", ctypes.c_size_t),
            ("peak_process", ctypes.c_size_t),
            ("peak_job", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
    limits.process_memory = MAX_MEMORY
    if (
        not job
        or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
        or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())
    ):
        raise RuntimeError("无法建立文档解析内存隔离，请使用手动填写")
    return job


def _extract(data: bytes) -> tuple[str, str, list[dict]]:
    if data.startswith(b"%PDF-"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("PDF已加密，请先解密或手动填写")
        if len(reader.pages) > 50:
            raise ValueError("PDF超过50页，请缩减或手动填写")
        parts, blocks = [], []
        for page_number, page in enumerate(reader.pages, 1):
            page_blocks = []

            def visitor(text, cm, tm, font, size, output=page_blocks, number=page_number):
                if text.strip():
                    output.append(
                        {
                            "kind": "pdf_text",
                            "page": number,
                            "text": text,
                            "x": round(tm[4], 2),
                            "y": round(tm[5], 2),
                        }
                    )

            if "/Contents" in page:
                page.extract_text(visitor_text=visitor)
                page_text = page.extract_text(extraction_mode="layout") or ""
            else:
                page_text = ""
            parts.append(page_text)
            blocks.extend(page_blocks)
            if sum(len(p) for p in parts) > 100000:
                raise ValueError("提取文本超过100000字符")
        text = "\n\f\n".join(parts)
        if not text.strip():
            raise ValueError("PDF未提取到文本，可能是扫描件；请上传文本版或手动填写")
        return text, "pdf", blocks
    if data.startswith(b"PK"):
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(x.file_size for x in archive.infolist()) > 100 * 1024 * 1024:
                raise ValueError("DOCX解压内容超过100MB")
            names = archive.namelist()
            if "word/document.xml" not in names or any("vbaProject" in n for n in names):
                raise ValueError("仅支持无宏的DOCX文档")
        document = Document(io.BytesIO(data))
        lines, blocks = [], []
        seen_cells = set()

        def walk(container, path):
            for index, item in enumerate(container.iter_inner_content()):
                location = f"{path}/{index}"
                if isinstance(item, Paragraph):
                    lines.append(item.text)
                    blocks.append({"kind": "paragraph", "location": location, "text": item.text})
                elif isinstance(item, Table):
                    for row_index, row in enumerate(item.rows):
                        for cell_index, cell in enumerate(row.cells):
                            # lxml element identity catches horizontal and vertical merged cells.
                            if cell._tc in seen_cells:
                                continue
                            seen_cells.add(cell._tc)
                            walk(cell, f"{location}/row/{row_index}/cell/{cell_index}")

        walk(document, "document")
        text = "\n".join(lines)
        if len(text) > 100000:
            raise ValueError("提取文本超过100000字符")
        return text, "docx", blocks
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        raise ValueError("旧版DOC请转换为DOCX或文本PDF")
    if b"\x00" in data[:4096]:
        raise ValueError("文件不是可识别的DOCX、PDF或UTF-8文本")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("文本请保存为UTF-8，或上传DOCX / 文本PDF") from exc
    if not text.strip() or len(text) > 100000:
        raise ValueError("文本为空或超过100000字符")
    return text, "txt", [{"kind": "text", "text": text}]


def _worker(data: bytes, sender):
    try:
        handle = _memory_limit()
        text, kind, blocks = _extract(data)
        sender.send(
            {
                "text": text,
                "format": kind,
                "blocks": blocks,
                "warnings": ["PDF版式可能影响阅读顺序，请对照原文检查经历和日期"] if kind == "pdf" else [],
            }
        )
        _ = handle
    except Exception as exc:
        sender.send({"error": str(exc)[:250] or "解析失败，请手动填写"})
    finally:
        sender.close()


def extract_document(data: bytes) -> dict:
    if not data or len(data) > MAX_FILE:
        raise ValueError("单文件必须在1字节到20MB之间")
    ctx = mp.get_context("spawn")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_worker, args=(data, sender), daemon=True)
    process.start()
    sender.close()
    started = time.monotonic()
    try:
        while time.monotonic() - started < 30:
            if receiver.poll(0.05):
                try:
                    result = receiver.recv()
                except EOFError as exc:
                    raise ValueError("解析进程已停止，请手动填写") from exc
                if "error" in result:
                    raise ValueError(result["error"])
                return result
            if not process.is_alive():
                raise ValueError("解析进程已停止或达到资源限制，请手动填写")
            try:
                if psutil.Process(process.pid).memory_info().rss > MAX_MEMORY:
                    raise ValueError("解析达到512MB内存限制，请手动填写")
            except psutil.NoSuchProcess:
                continue
        raise ValueError("解析超过30秒，请手动填写")
    finally:
        if process.is_alive():
            process.terminate()
        process.join(3)
        receiver.close()
