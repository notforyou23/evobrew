# Evobrew Launch Checklist

**Date:** 2026-02-16  
**Repo:** https://github.com/notforyou23/evobrew  
**Status:** Ready to push

---

## ✅ Pre-Push (Complete)

- [x] Fresh repo created at `/Users/jtr/_JTR23_/evobrew`
- [x] Rebranded from "COSMO IDE" → "Evobrew"
- [x] LICENSE added (MIT)
- [x] README.md rewritten (no COSMO references)
- [x] package.json updated (name, version, repo URL)
- [x] .env removed (never commit secrets)
- [x] Git initialized, first commit created
- [x] Remote added: https://github.com/notforyou23/evobrew.git

---

## 🚀 Push to GitHub

```bash
cd /Users/jtr/_JTR23_/evobrew
git push -f origin main
```

**This will:** Overwrite old private repo with fresh Evobrew v1.0.0

---

## 🌍 Make Public

1. Go to https://github.com/notforyou23/evobrew/settings
2. Scroll to "Danger Zone"
3. Click "Change repository visibility"
4. Select "Public"
5. Confirm

---

## 📝 Optional (Post-Launch)

### GitHub Settings
- [ ] Add topics: `ai`, `ide`, `knowledge-graph`, `semantic-search`, `claude`, `gpt-4`, `openai`
- [ ] Add description: "AI development workspace with semantic knowledge graphs"
- [ ] Enable Discussions
- [ ] Enable Issues
- [ ] Add website: https://evobrew.ai (when ready)

### Domain Setup
- [ ] Point evobrew.ai to GitHub Pages or hosting
- [ ] Set up DNS (A/CNAME records)
- [ ] Optional: Cloudflare for SSL/CDN

### NPM Package
- [ ] Publish to NPM: `npm publish`
- [ ] Test install: `npm install -g evobrew`

### Social/Promotion
- [ ] Create X/Twitter account (@evobrew or @evobrewai)
- [ ] Product Hunt launch
- [ ] Reddit r/programming, r/MachineLearning
- [ ] HN "Show HN: Evobrew - AI workspace with knowledge graphs"

---

## 🧪 Post-Push Testing

```bash
# Clone fresh copy
cd ~/test
git clone https://github.com/notforyou23/evobrew.git
cd evobrew

# Test install
npm install

# Copy .env
cp .env.example .env
# Edit .env with test API keys

# Test startup
npm start
# Open http://localhost:3405
```

---

## 📊 Launch Metrics to Track

- GitHub stars
- Issues/PRs
- NPM downloads (if published)
- Website traffic (if evobrew.ai setup)
- Community feedback

---

**You're ready!** Run the push command when you're set.
