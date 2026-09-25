import sys, os, traceback
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.services.tts_service import generate_speech_wav

tests = [
    ('en', 'Hello world'),
    ('hi', 'नमस्ते, आप कैसे हैं?'),
    ('te', 'హలో ప్రపంచం')
]
for lang, text in tests:
    print('---', lang)
    try:
        path, ctype = generate_speech_wav(text, language=lang)
        print('OK', path, ctype)
        with open(path, 'rb') as f:
            hdr = f.read(12)
        print('HDR', hdr[:4], hdr[8:12], 'size', os.path.getsize(path))
        # cleanup
        try:
            os.remove(path)
        except Exception:
            pass
    except Exception as e:
        traceback.print_exc()
        print('ERR', type(e).__name__, str(e)[:400])
