import asyncio
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.providers.sarvam_translation import SarvamTranslationProvider

async def run_tests():
    prov = SarvamTranslationProvider()
    pairs = [('en','bn'),('en','ta'),('en','kn'),('en','ml'),('en','mr'),('en','gu'),('en','pa'),('en','or')]
    for s,t in pairs:
        try:
            res = await prov.translate('Hello world', s, t)
            print(f"{s}->{t} OK: {res.translated_text[:120]}")
        except Exception as e:
            print(f"{s}->{t} ERR: {type(e).__name__}: {str(e)[:200]}")

if __name__ == '__main__':
    asyncio.run(run_tests())
