#!/usr/bin/env python3
"""Package the exact published deb; never rebuild or relabel app code."""
import hashlib,json,re,subprocess,sys
from pathlib import Path

tag=sys.argv[1]
assert re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+",tag), 'Expected vX.Y.Z'
def gh(*args):return subprocess.check_output(['gh',*args],text=True)
release=json.loads(gh('api',f'repos/{__import__("os").environ["GITHUB_REPOSITORY"]}/releases/tags/{tag}'))
assert not release['draft'], 'Only published releases may be packaged'
assets=[a for a in release['assets'] if a['name'].endswith('_amd64.deb')]
assert len(assets)==1, 'Expected exactly one amd64 deb'
asset=assets[0]
subprocess.run(['gh','release','download',tag,'--pattern',asset['name'],'--dir','.snap-download'],check=True)
deb=Path('.snap-download')/asset['name']
digest=asset.get('digest')
assert digest and digest.startswith('sha256:'), 'Release asset SHA256 digest missing'
assert hashlib.sha256(deb.read_bytes()).hexdigest()==digest[7:], 'Release deb digest differs'
version=subprocess.check_output(['dpkg-deb','-f',str(deb),'Version'],text=True).strip()
assert version==tag[1:], f'Deb version {version} differs from {tag}'
Path('release.deb').write_bytes(deb.read_bytes())
manifest=json.loads(Path('docs/branding/icons.json').read_text())
for icon in manifest:
 assert hashlib.sha256(Path(icon['source']).read_bytes()).hexdigest()==icon['sha256'], 'Approved logo source differs'
recipe=Path('snap/snapcraft.yaml')
recipe.write_text(re.sub(r"^version:.*",f"version: '{version}'",recipe.read_text(),flags=re.M))
Path('.snap-download/provenance.json').write_text(json.dumps({'tag':tag,'asset':asset['name'],'sha256':digest,'release_commit':release['target_commitish']},indent=2))
