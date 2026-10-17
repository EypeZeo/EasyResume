def reader(client):
    code = client.post('/api/v1/pairing').json()['code']
    token = client.post('/api/v1/pair', json={'code': code}).json()['token']
    return {'Authorization': f'Bearer {token}', 'Origin': 'chrome-extension://synthetic'}


def test_platform_identity_is_not_shared_between_boss_and_zhilian(client):
    headers = reader(client)
    for url in ('https://www.zhipin.com/job_detail/same-id.html',
                'https://www.zhaopin.com/jobdetail/same-id.htm'):
        response = client.post('/api/v1/observations', headers=headers, json={
            'url': url, 'title': '合成网络运维', 'company': '合成企业',
            'platform_job_id': 'same-id', 'text': '本科，Linux，固定月薪6000-7000元，周末双休。',
            'page_kind': 'detail',
        })
        assert response.status_code == 200, response.text
    jobs = client.get('/api/v1/state').json()['jobs']
    assert len(jobs) == 2
    assert {job['data']['platform'] for job in jobs} == {'boss', 'zhaopin'}
    assert all(job['data']['salary_min'] == 6000 for job in jobs)


def test_observation_rejects_other_hosts_credentials_and_private_routes(client):
    headers = reader(client)
    for url in ('https://www.zhaopin.com.evil.example/jobs/',
                'https://user:secret@www.zhaopin.com/jobs/',
                'https://www.zhaopin.com/chat/', 'https://www.zhipin.com/web/geek/resume'):
        response = client.post('/api/v1/observations', headers=headers,
                               json={'url': url, 'title': '合成岗位', 'text': '不应导入'})
        assert response.status_code == 422
    assert not client.get('/api/v1/state').json()['jobs']
