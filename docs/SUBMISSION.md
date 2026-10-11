---
title: "Outbound 🌱 An AI Quest App That Wants You to Close It"
published: true
description: "Three outdoor quests, one small decision, and an AI system designed to get out of your way."
tags: devchallenge, hf26challenge, ai, hacktoberfest
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).*

## What I Built

🌱 **What if an app's best outcome was that you stopped using it?**

You have fifteen minutes. You have been looking at a screen for too long. A workout sounds like too much, and "just go for a walk" does not quite give you a reason to start.

That gap between wanting to do something and choosing something is the problem I wanted to work on. A feed offers the next thing to look at. I wanted to offer the next thing to do.

I built **Outbound**, a gamified outdoor quest app using open-weight models that can run locally. It suggests three activities using your settings, interests, past feedback, and available local information. Choose one, put the phone away, and return with a short reflection.

**The idea is not to make leaving the screen another demanding task. It is to make the next step small enough to take.**

![Outbound's homepage showing outing settings and three selectable outdoor quests](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/6ick4ztl9jpjf156sj4g.png)
*Figure 1. A decision, not a feed. Actual app interface using automated demo data.*

The experience is deliberately small:

- **Your profile:** editable interests, goals, dislikes, and comfort levels.
- **Today's context:** time, mood, energy, and an optional starting point.
- **Three choices, not a feed:** Easy Win, Useful Quest, and Stretch Quest, selected from **120 activities**. Notice something new on a familiar walk, sketch outdoors, or check a detail for tomorrow's errand.
- **Useful feedback:** mark complete, partial, or skipped, optionally rate it, and leave a note. "Bring water next time" can become a reminder for a similar activity.
- **Gentle rewards:** badges, streaks, and sounds acknowledge participation. **Partial Counts** is a badge too; showing up need not go perfectly.
- **Optional voice:** ElevenLabs reads quests, transcribes notes, and speaks encouragement after your reflection.

![Three mobile app views showing quest selection, an outing timer, and a short reflection form](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/gu6agjioxk4ckiaz9tif.png)
*Figure 2. Choose, go, reflect. These screenshots use controlled UI fixtures.*

This is for someone between work, study, or chores who wants a little movement, curiosity, or confidence, but needs a reason to start.

> 📱 The design goal: spend less effort deciding on the screen, and more time doing something outside.

## Demo

🚀 **[Try Outbound](https://outbound-taqn.onrender.com/)**

1. Set a few interests and choose today's time and energy. Share a starting point only if you want nearby-place suggestions.
2. Generate three quests, choose one, and start the quiet outing timer. Put the phone away; there is no feed to follow.
3. Return and save a short reflection. Completed, partial, and skipped are all valid feedback.

🔍 **To inspect a decision:** Recommendation lab → Seed demo data → Run demo recommendation.

- See sources, rejected activities, predictions, and selection scores.
- Synthetic demo history stays separate from your personal progress.
- A new profile starts with preference-based ranking, not learned personalization.

### A Small Outing Still Has to Fit

For an **illustrative** fifteen-minute outing when you feel tired:

- **Too far:** a garden with a twenty-eight-minute walking round trip is ruled out before prediction.
- **Too demanding:** low-energy settings exclude strenuous activities.
- **Still possible:** a short, familiar walk might remain.

A confident description cannot make the garden closer.

![A named-place quest displaying walking time, activity time, and a reserve for the outing](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/5u1809ws6lu45ibl93ri.png)
*Figure 3. An illustrative quest showing how walking time, activity time, and a return buffer fit within your available time.*

That distinction matters: **Outbound should give you a usable reason to leave, not a convincing reason that falls apart at the door.**

## Code

- 💻 **[Source code](https://github.com/Sahil-Jaiswal-189/Outbound)**
- 🛠️ **[Setup and prerequisites](https://github.com/Sahil-Jaiswal-189/Outbound#prerequisites)**
- 🧩 **[Detailed architecture](https://github.com/Sahil-Jaiswal-189/Outbound/blob/main/ARCHITECTURE.md)**

**Stack:** JavaScript, Lucide, and Leaflet in the browser; Node and SQLite in the backend; Python/TabPFN and Ollama/Qwen for inference. Run locally or together in one Docker service.

## How I Built It

🧩 **The most useful improvement was giving each part one clear job.**

An earlier version added mood and place bonuses on top of predictions. That made the decision harder to explain. I simplified it: **check what fits, predict outcomes, choose three, then add friendly wording.**

![Outbound workflow: build and filter activities, estimate outcomes with TabPFN, select three, add Qwen wording, and save feedback in SQLite](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/c5xmowgdnxfaib53hpid.png)
*Figure 4. One feedback loop, with a different job at each step. AI-generated diagram checked against the implementation.*

### 1. Facts Decide What Fits

- **Open-Meteo:** weather and modeled air quality.
- **OpenStreetMap / Overpass:** mapped nearby places.
- **openrouteservice:** walking-time estimates.

Our code combines these facts with your settings to remove unsuitable activities **before prediction**. A named destination must fit travel, activity, and return time. Failed lookups are reported; suitable general activities can remain, without inventing a place.

### 2. TabPFN Asks Whether It Might Work for You

- **Remember:** SQLite stores your profile, outings, and feedback.
- **Predict:** TabPFN v2 uses past outcomes and selected details, including mood, weather, duration, and effort, to estimate completion and liking separately.
- **Check:** each outcome must beat a simpler estimate on history not used for fitting. Until enough usable history exists, goals and hobbies guide ranking.
- **Update:** feedback adds examples, not a new round of model-weight training.

**Finishing something and enjoying it are different signals. The model has to earn its place.**

### 3. Selection Makes a Choice, Not an Endless Ranking

> **Model-based score = average of completion and liking estimates − repetition penalty.**

- **Partial model use:** an outcome that fails the check keeps its simpler estimate.
- **No validated model:** use goal/hobby fit minus repetition instead.
- **Variety:** avoid duplicate activities and destinations, seek different categories, and occasionally explore a less-tried category.

**These are selection rules, not another AI model.**

### 4. Qwen Makes the Wording Friendly

- **Wording:** Qwen2.5:3b runs through Ollama after selection, writing titles, reflection prompts, and later encouragement.
- **Personal context:** profile details and relevant notes, not per-user fine-tuning.
- **Facts:** destinations, timings, instructions, and evidence-based explanations stay backend-controlled.
- **Fallback:** failed or invalid model output leaves the template quests usable.

**Qwen's job is warmth, not deciding where you should go.**

### What I Have Verified

- 🔬 **75 automated tests passed** in build verification, covering filtering, separate demo history, repetition, and model-failure fallbacks.
- **Real local TabPFN inference:** 120 synthetic outings; both outcomes beat simpler estimates on examples held out of fitting.

| Prediction | Baseline error | TabPFN error |
| --- | ---: | ---: |
| Full completion | 0.0975 | 0.0588 |
| Liking | 0.1203 | 0.0689 |

**Reading the table:** Brier scores measure prediction error; lower is better. This small synthetic test demonstrates the working system, **not real-user performance or better habits**.

![Recommendation lab showing real TabPFN predictions on synthetic history, validation results, and candidate scores](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/tfxgu9wvxljrnh45kvdl.png)
*Figure 5. Real TabPFN output on synthetic history, with no live sources or Qwen wording. See the [saved results](https://github.com/Sahil-Jaiswal-189/Outbound/blob/main/docs/assets/lab-model.evidence.json) and [capture script](https://github.com/Sahil-Jaiswal-189/Outbound/blob/main/scripts/capture-model-lab.mjs).*

### What I Learned Outside

**I used Outbound during development, trying a few quests that took me to a local shop and a nearby café.** The early recommendations felt too generic, so I improved the real-world context and expanded the activity catalog. I also added a timer, feedback, badges, and optional voice to make the experience more engaging. These were informal personal trials, not a study of long-term habit change.

### What Still Needs Work

- **Speed:** cold models and public map services can still delay recommendations despite caching. Shortening that wait is the next priority.
- **Place details:** access and opening hours remain unverified.
- **Completion:** self-reported, not location-tracked. This is not a medical or safety tool.

Those few outings were a starting point. The next step is to test with more people: can they choose comfortably, leave the app alone, and return with useful feedback?

## Why Does Open Innovation Matter?

🔓 **A personal recommendation needs personal feedback. I wanted to control where that feedback goes and how it shapes the next choice.**

Qwen's open weights, TabPFN's model and code, and the open-source Ollama runtime give me three practical benefits:

- **Control over personal history.** Laptop mode keeps storage and inference on the laptop. The Render demo runs them on its server, not the visitor's phone.
- **An inspectable decision.** I can compare TabPFN with a simpler estimate, keep the fallback when it wins, and see which path was used.
- **Local computation.** Downloaded models can compute offline. Fresh weather, places, routes, and tiles need internet; coordinates go to providers. Optional speech text and recordings go to ElevenLabs.

For this project, that worked better than relying entirely on a hosted chatbot: I can run and test both models without a required hosted-inference fee, and control the selection rules. Closed models can also sit behind careful rules. **Our advantage is ownership of the setup, not universal model superiority.**

The boundaries are important too:

- **Costs:** hosting, hardware, and optional voice are not free.
- **Model terms:** [Qwen uses the Qwen Research license](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct); [TabPFN v2 uses the Prior Labs License with attribution requirements](https://huggingface.co/Prior-Labs/TabPFN-v2-clf).
- **Optional proprietary service:** ElevenLabs is separate from the local inference setup.

The freedom I care about is not making the app bigger. **It is being able to make the app ask less of you.**

## Prize Categories

### 📊 Best Use of TabPFN

- **Use:** predict completion and liking from outing feedback; check each outcome against a simpler alternative before model-based ranking.
- **Purpose:** recommend what someone might do and enjoy, not what keeps them clicking.
- **Evidence:** the lab, real-model screenshot, and saved results make the process inspectable.

### 🎙️ Best Use of ElevenLabs

- **Use:** narrate the selected quest, transcribe a recorded reflection, and speak Qwen's encouragement after the note is saved.
- **Purpose:** less reading and typing, without a conversation running throughout the outing.
- **Alternatives:** typed notes and browser speech remain available.

### 🚀 Best Use of Render

- **Use:** host the public demo with a single-service Docker setup for the app, Qwen, and TabPFN.
- **Purpose:** let people try Outbound without installing models. An attached persistent disk preserves history and model downloads.
- **Deployment:** only the web app is exposed publicly; model services stay internal. Configuration and setup instructions are in the repository.

---

🌿 **Outbound does not need you to become an outdoors person overnight.**

It needs to make one small outing easier to choose today. Whether it succeeds will be decided outside, not by how long someone stays in the app.

*This project and write-up were developed with AI assistance. Screenshots use controlled demo state; the prediction capture uses synthetic history. The app's park photograph is by [Tina Devidze on Unsplash](https://unsplash.com/photos/a-path-winds-through-a-sunny-green-park-lh_MesNhkbI), under the [Unsplash License](https://unsplash.com/license). Model and source-provider credits appear above and in the repository.*
