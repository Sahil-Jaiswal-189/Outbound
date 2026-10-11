# Publishing the Submission

[SUBMISSION.md](./SUBMISSION.md) is the Markdown source for the [published Outbound submission](https://dev.to/sahil_jaiswal_6affec34584/outbound-an-ai-quest-app-that-wants-you-to-close-it-2e9b). Its body matches the revised DEV article. Git pushes do not automatically update DEV.

## Updating the Existing Article

- Recheck [the live demo](https://outbound-taqn.onrender.com/) in a browser. A responding homepage does not establish that Qwen or TabPFN is ready. Inspect `/api/status` and the recommendation lab separately.
- Commit and push the intended code/docs/assets changes. Changes reach the deployed app only after Render successfully rebuilds and redeploys; verify the deployed policy and model readiness separately.
- The article uses five figures, all with public DEV-uploaded image URLs. No repository-relative image paths need replacing in the current submission. If a figure changes, upload its replacement and update the URL in both the Markdown and the existing article; uploaded images do not automatically change when local assets change.
- The figures cover the homepage, mobile outdoor loop, named-place quest, one workflow diagram and real-model lab results. `how-it-works-visual.png` is the single AI-generated diagram explaining filtering, prediction, selection and feedback; its labels and arrows were checked against the implementation. The detailed architecture figure remains in the README and architecture document. Extra screenshots and `three-possibilities.png` remain optional gallery assets; the latter is an AI-generated concept illustration, not a photograph of actual users.
- Preserve the captions: named-place screenshots use controlled source fixtures, and synthetic outcomes are not a real field test or performance study.
- The policy is `tabpfn-outcomes-slate-v5`: model/hybrid runs average outcome probabilities; fully baseline runs use a separate preference fallback. Keep text and figures synchronized with this distinction. `lab-model.png` shows actual local TabPFN v2 inference and chronological validation on 120 synthetic outings, not hosted-model readiness or real-world effectiveness. Its scores and validation results are recorded in `lab-model.evidence.json`.
- The submission lists only TabPFN, ElevenLabs and Render prize categories. Verify hosted model/voice access before recording a demo, and do not add categories without genuine use and supporting evidence.
- The repository currently has no application `LICENSE`. Choose an application license deliberately before describing your own code as licensed open source. Checkpoint-specific Qwen/TabPFN terms, OSM attribution, the photograph license and audio redistribution rights remain separate.
- Keep API keys, private notes, exact personal coordinates and cookies out of recordings. The supplied screenshots use test data, not the personal SQLite database.
- `published: true` records the article's current status; it does not publish anything by itself. When using DEV's editor or an API, upload only the article body after the YAML front matter. Update the existing article rather than creating another entry. Preserve its tags and cover, and keep the AI-assistance disclosure.

### Current Figure Order

| Figure | Subject | Local asset |
| --- | --- | --- |
| 1 | Homepage and three quest options | `docs/assets/home.png` |
| 2 | Mobile choose, go, reflect loop | `docs/assets/outdoor-loop.png` |
| 3 | Named destination and time budget | `docs/assets/quests.png` |
| 4 | Filtering, prediction, selection and feedback | `docs/assets/how-it-works-visual.png` |
| 5 | Real TabPFN output on synthetic history | `docs/assets/lab-model.png` |

## Reproduce the Figures

```bash
npx playwright install chromium
npm run test:browser
node scripts/build-post-assets.mjs
```

The script uses Chromium and the browser test screenshots to produce the PNG figures. `architecture.svg` and the earlier `how-it-works.svg` are editable diagram sources. Their labels are checked against the canvas and, where marked, their containing panels. The article uses `how-it-works-visual.png` instead of the earlier generated SVG export. The script does not regenerate that AI-created flowchart or `three-possibilities.png`; their prompts are preserved in `docs/assets/how-it-works-visual.prompt.txt` and `docs/assets/three-possibilities.prompt.txt`. Browser artifacts stay gitignored; selected publication figures belong in `docs/assets/`.

To reproduce Figure 5 after installing the local Python dependencies and Chromium:

```bash
node scripts/capture-model-lab.mjs
```

This runs real CPU TabPFN v2 inference using the app's synthetic seeder and an in-memory SQLite workspace, then renders the actual lab UI in a temporary browser server. The first run needs internet to download the checkpoint; the model cache defaults to `/tmp/outbound-figure6-models` (the script's original directory name, not the current figure number). No personal database, paid voice API or external location provider is used. The script refuses to publish a baseline-only run or identical visible scores, saves `lab-model.png` and `lab-model.evidence.json`, and shuts down its temporary browser/server. The standard asset builder still produces the separate fallback screenshot `lab.png`; it does not overwrite Figure 5.

## A Short Demo Recording

1. Show the profile and select time, mood, energy and goal.
2. Show a precise starting point and source facts; generate three quests.
3. Open the reasons and the destination/time breakdown, when a destination qualifies.
4. Start one quest and show the minimal field timer.
5. Record an actual outing separately if available; do not present scripted UI feedback as outdoor evidence.
6. Return, save an honest result and short note, and demonstrate optional voice/badge feedback.
7. Open the lab to show source status, target engine modes, validation and saved events.

The submission makes no claim that the app measurably reduces screen time, improves health, or has been field-tested. Add first-person observations only after actually using it outside.
