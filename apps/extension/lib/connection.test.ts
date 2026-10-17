import { describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { connectionState, pairingInfo, reconnectConnection, revokeConnection } from './connection';

const connection = {
  base: 'http://127.0.0.1:8765',
  token: 'synthetic-token',
  installation: 'synthetic-install',
};
const info = {
  base: connection.base,
  code: 'synthetic-code',
  expires_at: '2030-01-01T00:05:00Z',
  protocol: 1,
};
const now = Date.parse('2030-01-01T00:00:00Z');
const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

function signedProbe(init: RequestInit, status = 'active', origin = connection.base) {
  const input = JSON.parse(String(init.body));
  const instance = '0123456789abcdef0123456789abcdef';
  const message = `EasyResume:1:${input.installation_id}:${input.challenge}:${instance}:${status}:${origin}`;
  return {
    name: 'EasyResume',
    protocol: 1,
    ...input,
    instance,
    status,
    origin,
    proof: createHmac('sha256', createHash('sha256').update(connection.token).digest('hex'))
      .update(message)
      .digest('hex'),
  };
}

const provenResponse = (status = 200) =>
  vi.fn<typeof fetch>().mockImplementation(
    async (input, init = {}) =>
      new Response(JSON.stringify(String(input).endsWith('/probe') ? signedProbe(init) : {}), {
        status: String(input).endsWith('/probe') ? 200 : status,
      }),
  );

describe('pairing information', () => {
  it('decodes grouped digits, including a non-default port, without a remote address', () => {
    for (const input of [
      '08765-12345-67890-12345-67890',
      '08765 12345 67890 12345 67890',
      '08765' + '12345678901234567890',
    ]) {
      const result = pairingInfo(input);
      expect(result.base).toBe('http://127.0.0.1:8765');
      expect(result.code).toHaveLength(20);
      expect(result.expires_at).toBeUndefined();
    }
    expect(pairingInfo('19000-12345-67890-12345-67890')).toEqual({
      base: 'http://127.0.0.1:19000',
      code: '12345678901234567890',
      protocol: 1,
    });
    for (const input of [
      '00000-12345-67890-12345-67890',
      '65536-12345-67890-12345-67890',
      '08765-12345-67890-12345-6789',
      '08765-12345-67890-12345-6789x',
    ])
      expect(() => pairingInfo(input)).toThrow();
  });
  it('accepts current loopback information without exposing a long-lived credential', () => {
    expect(pairingInfo(JSON.stringify(info), now)).toEqual(info);
  });
  it('rejects malformed, expired, remote or incompatible information', () => {
    for (const data of [
      { ...info, expires_at: 'bad' },
      { ...info, expires_at: '2020-01-01' },
      { ...info, base: 'https://example.com' },
      { ...info, protocol: 2 },
      { ...info, code: '' },
    ]) {
      expect(() => pairingInfo(JSON.stringify(data), now)).toThrow();
    }
    expect(() => pairingInfo('not json', now)).toThrow('完整连接码');
  });
});

describe('disconnect confirmation', () => {
  it('revokes only the paired connection using authenticated DELETE', async () => {
    const request = provenResponse();
    expect(await revokeConnection(connection, request)).toBe(true);
    expect(request).toHaveBeenCalledWith(
      `${connection.base}/api/v1/connection`,
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: `Bearer ${connection.token}` },
        redirect: 'error',
      }),
    );
    expect(await revokeConnection(connection, provenResponse(401))).toBe(true);
    expect(await revokeConnection(connection, provenResponse(403))).toBe(true);
  });
  it('does not claim server revocation when offline or unsupported', async () => {
    expect(
      await revokeConnection(
        connection,
        vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
      ),
    ).toBe(false);
    expect(await revokeConnection(connection, respond({}, 404))).toBe(false);
    const request = respond({});
    expect(await revokeConnection({ ...connection, base: 'https://example.com' }, request)).toBe(
      false,
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('does not reveal a token to an occupied port when disconnecting', async () => {
    const request = respond({ name: 'EasyResume', protocol: 1 });
    expect(await revokeConnection(connection, request)).toBe(false);
    expect(
      request.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Authorization')),
    ).toBe(true);
  });
});

describe('authenticated connection health', () => {
  it('does not treat a stored credential as proof of connection', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    expect(await connectionState(connection, request)).toBe('offline');
    expect(await connectionState(undefined, request)).toBe('unpaired');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires the expected protocol and paired installation', async () => {
    const request = respond({ protocol: 1, installation_id: connection.installation });
    expect(await connectionState(connection, request)).toBe('connected');
    expect(request).toHaveBeenCalledWith(
      `${connection.base}/api/v1/connection`,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${connection.token}` },
        redirect: 'error',
        cache: 'no-store',
      }),
    );
    expect(
      await connectionState(connection, respond({ protocol: 1, installation_id: 'another' })),
    ).toBe('incompatible');
    expect(
      await connectionState(
        connection,
        respond({ protocol: 2, installation_id: connection.installation }),
      ),
    ).toBe('incompatible');
  });
  it('distinguishes revoked credentials, old services and unavailable services', async () => {
    expect(await connectionState(connection, respond({}, 401))).toBe('expired');
    expect(await connectionState(connection, respond({}, 403))).toBe('expired');
    expect(await connectionState(connection, respond({}, 404))).toBe('incompatible');
    expect(await connectionState(connection, respond({}, 503))).toBe('offline');
  });
  it('never sends stored tokens to a non-loopback destination', async () => {
    const request = respond({});
    expect(await connectionState({ ...connection, base: 'https://example.com' }, request)).toBe(
      'incompatible',
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe('automatic reconnection with service proof', () => {
  const proof = signedProbe;

  it('finds a changed port without revealing a token to the old occupied port', async () => {
    const moved = 'http://127.0.0.1:19001';
    const old = { ...connection, base: 'http://127.0.0.1:19000' };
    const request = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
      const url = String(input);
      if (url.startsWith(moved)) {
        return new Response(
          JSON.stringify(
            url.endsWith('/probe')
              ? proof(init, 'active', moved)
              : { protocol: 1, installation_id: connection.installation },
          ),
        );
      }
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return new Response('{}', { status: 404 });
    });
    const result = await reconnectConnection(old, [], request);
    expect(result).toEqual({ state: 'connected', connection: { ...old, base: moved } });
    expect(old.base).toBe('http://127.0.0.1:19000');
    const authenticated = request.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).has('Authorization'),
    );
    expect(authenticated).toHaveLength(1);
    expect(String(authenticated[0][0])).toBe(`${moved}/api/v1/connection`);
  });

  it('uses the open workbench hint and rejects remote address hints', async () => {
    const moved = 'http://127.0.0.1:22000';
    const request = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
      if (!String(input).startsWith(moved)) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify(
          String(input).endsWith('/probe')
            ? proof(init, 'active', moved)
            : { protocol: 1, installation_id: connection.installation },
        ),
      );
    });
    expect(
      (await reconnectConnection(connection, ['https://example.com', moved], request)).state,
    ).toBe('connected');
    expect(
      request.mock.calls.every(([input]) => String(input).startsWith('http://127.0.0.1:')),
    ).toBe(true);
  });

  it('recognizes authenticated revocation without sending a bearer or creating a pairing', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (_input, init = {}) => new Response(JSON.stringify(proof(init, 'revoked'))),
      );
    expect((await reconnectConnection(connection, [], request)).state).toBe('expired');
    expect(request).toHaveBeenCalledTimes(1);
    expect(new Headers(request.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  });

  it('does not trust a copied health response or a forged challenge proof', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_input, init = {}) => {
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return new Response(JSON.stringify({ ...proof(init), proof: '0'.repeat(64) }));
    });
    expect((await reconnectConnection(connection, [], request)).state).toBe('offline');
    expect(request.mock.calls.every(([input]) => String(input).endsWith('/probe'))).toBe(true);
  });

  it('rejects stale challenges and wrong installations even if the rest looks valid', async () => {
    for (const change of [{ challenge: '0'.repeat(64) }, { installation_id: 'another' }]) {
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async (_input, init = {}) => new Response(JSON.stringify({ ...proof(init), ...change })),
        );
      expect((await reconnectConnection(connection, [], request)).state).toBe('offline');
      expect(
        request.mock.calls.every(([, init]) => !new Headers(init?.headers).has('Authorization')),
      ).toBe(true);
    }
  });

  it('rejects a genuine proof relayed from a different local listening port', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_input, init = {}) => {
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return new Response(JSON.stringify(proof(init, 'active', 'http://127.0.0.1:9999')));
    });
    expect((await reconnectConnection(connection, [], request)).state).toBe('offline');
  });

  it('preserves offline pairing and never contacts a non-loopback stored service', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    expect(await reconnectConnection(undefined, [], request)).toEqual({ state: 'unpaired' });
    expect(request).not.toHaveBeenCalled();
    expect(
      (await reconnectConnection({ ...connection, base: 'https://example.com' }, [], request))
        .state,
    ).toBe('incompatible');
    expect(request).not.toHaveBeenCalled();
    expect(await reconnectConnection(connection, [], request)).toEqual({
      state: 'offline',
      connection,
    });
  });
});
