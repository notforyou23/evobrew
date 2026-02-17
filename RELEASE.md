# Release in one command

## Normal release (patch)
```bash
npm run ship
```

That’s it.

What it does:
1. bumps version (patch)
2. creates git tag (`vX.Y.Z`)
3. pushes tag
4. GitHub Action publishes to npm

## If you need bigger bumps
```bash
npm run release:minor
npm run release:major
```
