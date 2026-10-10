# Publishing the Submission

[SUBMISSION.md](./SUBMISSION.md) is a DEV-format draft with the requested sections, tags, live demo URL and visual captions. It is not published automatically.

## Before Publishing

- Recheck [the live demo](https://outbound-taqn.onrender.com/) in a browser. The homepage returned HTTP 200 during preparation; this does not establish that Qwen or TabPFN is ready. Inspect `/api/status` and the recommendation lab separately.
- Commit and push the intended code/docs/assets changes. Changes reach the deployed app only after Render successfully rebuilds and redeploys; verify the deployed policy and model readiness separately.
- The narrative keeps four original uploaded DEV images. Three images use repository-relative paths: `docs/assets/architecture.png`, `docs/assets/how-it-works-visual.png` and `docs/assets/lab-model.png`. Upload these three PNGs using DEV's image uploader and replace their relative Markdown paths with the returned URLs. Relative paths work in the repository, not in a copied DEV post. Alternatively, use public raw GitHub asset URLs after committing and pushing the figures.
- The original images cover the homepage, three-possibilities concept, outdoor loop, named-place quest, architecture and lab. `how-it-works-visual.png` is the single AI-generated diagram explaining filtering, prediction, selection and feedback; its labels and arrows were checked against the implementation. Extra profile, catalog, source and mobile screenshots are included for a gallery or demo video. `three-possibilities.png` is an AI-generated concept illustration, not a screenshot or photograph of actual users.
- Existing uploaded image URLs do not update when local files change. The previous architecture and lab uploads were checked and still show outdated selection labels and score columns; the draft now references the current local versions. Upload them along with the new flowchart before publishing. The narrative otherwise retains the supplied wording, with factual corrections and the new data-flow section.
- Preserve the captions: named-place screenshots use controlled source fixtures, and synthetic outcomes are not a real field test or performance study.
- The revised policy is `tabpfn-outcomes-slate-v5`: model/hybrid runs average outcome probabilities; fully baseline runs use a separate preference fallback. Publish the updated architecture and lab images plus the new flowchart together with the corrected text. `lab-model.png` shows actual local TabPFN v2 inference and chronological validation on 120 synthetic outings, not hosted-model readiness or real-world effectiveness. Its scores and validation results are recorded in `lab-model.evidence.json`.
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

The script uses Chromium and the browser test screenshots to produce the PNG figures. `architecture.svg` and the earlier `how-it-works.svg` are editable diagram sources. Their labels are checked against the canvas and, where marked, their containing panels. The article uses `how-it-works-visual.png` instead of the earlier generated SVG export. The script does not regenerate that AI-created flowchart or `three-possibilities.png`; their prompts are preserved in `docs/assets/how-it-works-visual.prompt.txt` and `docs/assets/three-possibilities.prompt.txt`. Browser artifacts stay gitignored; selected publication figures belong in `docs/assets/`.

To reproduce Figure 6 after installing the local Python dependencies and Chromium:

```bash
node scripts/capture-model-lab.mjs
```

This runs real CPU TabPFN v2 inference using the app's synthetic seeder and an in-memory SQLite workspace, then renders the actual lab UI in a temporary browser server. The first run needs internet to download the checkpoint; the model cache defaults to `/tmp/outbound-figure6-models`. No personal database, paid voice API or external location provider is used. The script refuses to publish a baseline-only run or identical visible scores, saves `lab-model.png` and `lab-model.evidence.json`, and shuts down its temporary browser/server. The standard asset builder still produces the separate fallback screenshot `lab.png`; it does not overwrite Figure 6.

## A Short Demo Recording

1. Show the profile and select time, mood, energy and goal.
2. Show a precise starting point and source facts; generate three quests.
3. Open the reasons and the destination/time breakdown, when a destination qualifies.
4. Start one quest and show the minimal field timer.
5. Record an actual outing separately if available; do not present scripted UI feedback as outdoor evidence.
6. Return, save an honest result and short note, and demonstrate optional voice/badge feedback.
7. Open the lab to show source status, target engine modes, validation and saved events.

The draft makes no claim that the app measurably reduces screen time, improves health, or has been field-tested. Add first-person observations only after actually using it outside.
