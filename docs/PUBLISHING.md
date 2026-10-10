# Publishing the Submission

[SUBMISSION.md](./SUBMISSION.md) is a DEV-format draft with the requested sections, tags, live demo URL and visual captions. It is not published automatically.

## Before Publishing

- Recheck [the live demo](https://outbound-taqn.onrender.com/) in a browser. The homepage returned HTTP 200 during preparation; this does not establish that Qwen or TabPFN is ready. Inspect `/api/status` and the recommendation lab separately.
- Commit and push the intended code/docs/assets changes. Changes reach the deployed app only after Render successfully rebuilds and redeploys; verify the deployed policy and model readiness separately.
- Upload the PNG files from `docs/assets/` using DEV's image uploader and replace the relative Markdown image paths with the returned image URLs. Relative paths work in the repository, not in a copied DEV post. Alternatively, use public raw GitHub asset URLs after committing and pushing the figures.
- `home.png` shows the actual homepage with outing settings on the left and all three quests on the right. The remaining submission figures are `outdoor-loop.png`, `quests.png`, `architecture.png` and `lab.png`. Extra profile, catalog, source and mobile screenshots are included for a gallery or demo video. The unused `three-possibilities.png` is an AI-generated concept illustration, not a screenshot or photograph of actual users; it is not embedded in the submission.
- Preserve the captions: named-place screenshots use controlled source fixtures, and synthetic outcomes are not a real field test or performance study.
- The revised policy is `tabpfn-outcomes-slate-v5`: model/hybrid runs average outcome probabilities; fully baseline runs use a separate preference fallback. Republish the updated architecture, homepage, quest and lab images together with the text. The supplied lab image shows fallback scoring, not successful hosted TabPFN inference.
- No DevRelay link was supplied. The draft says so rather than fabricating a session. Add an actual session link later only if one exists.
- Review the prize categories against what is deployed and demonstrable. TabPFN and ElevenLabs integrations are present; Render's public URL is supplied. The author confirmed GitHub Copilot use during development; add a concrete example or session link if available, keeping it distinct from Codex sessions. Verify hosted model/voice access before recording a demo. Gemma, Tinker and the other unimplemented partner integrations are intentionally not claimed.
- The repository currently has no application `LICENSE`. Choose an application license deliberately before describing your own code as licensed open source. Checkpoint-specific Qwen/TabPFN terms, OSM attribution, the photograph license and audio redistribution rights remain separate.
- Keep API keys, private notes, exact personal coordinates and cookies out of recordings. The supplied screenshots use test data, not the personal SQLite database.
- `published: false` is draft metadata, not a publishing command. Use DEV's editor to publish after reviewing the text and assets.

## Reproduce the Figures

```bash
npx playwright install chromium
npm run test:browser
node scripts/build-post-assets.mjs
```

The script uses Chromium and the browser test screenshots to produce the PNG figures. `architecture.svg` is the editable diagram source. It does not regenerate the AI-created `three-possibilities.png`; the original prompt is preserved in `docs/assets/three-possibilities.prompt.txt`. Browser artifacts stay gitignored; selected publication figures belong in `docs/assets/`.

## A Short Demo Recording

1. Show the profile and select time, mood, energy and goal.
2. Show a precise starting point and source facts; generate three quests.
3. Open the reasons and the destination/time breakdown, when a destination qualifies.
4. Start one quest and show the minimal field timer.
5. Record an actual outing separately if available; do not present scripted UI feedback as outdoor evidence.
6. Return, save an honest result and short note, and demonstrate optional voice/badge feedback.
7. Open the lab to show source status, target engine modes, validation and saved events.

The draft makes no claim that the app measurably reduces screen time, improves health, or has been field-tested. Add first-person observations only after actually using it outside.
