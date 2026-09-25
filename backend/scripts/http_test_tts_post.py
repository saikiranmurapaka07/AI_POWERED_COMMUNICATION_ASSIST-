import httpx, json
url='http://127.0.0.1:8000/api/tts'
payload={'text':'Hello from frontend test','language':'en','speaker':'default','pace':1.0,'temperature':0.5}
print('POST', url, '\npayload=', payload)
with httpx.Client(timeout=30.0) as c:
    r=c.post(url,json=payload)
    print('status', r.status_code)
    print('headers:', r.headers.get('content-type'))
    b=r.content
    print('body bytes len=', len(b))
    print('first 16 bytes:', b[:16])
