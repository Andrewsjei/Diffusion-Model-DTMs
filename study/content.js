// ---------------------------------------------------------------------
// Everything in this file is meant to be edited without touching app.js
// or admin.js. See study/README.md § "Changing the intro text" and
// § "Supabase setup" for the full walkthrough.
// ---------------------------------------------------------------------
window.STUDY_CONFIG = {
  // Project: pajxillufzoerhcgtnik. The publishable key is meant to be
  // public — it can only reach the Edge Functions below, nothing else
  // (see study/README.md, "Threat model"). Never put the secret key here.
  SUPABASE_URL: "https://pajxillufzoerhcgtnik.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_oJJe_5xKVrDln4YkbvhcOQ_KUhSy8FV",
};

window.STUDY_CONTENT = {
  page_title: "DTM diffusion-model evaluation study",

  // Shown at the top of the intro page. Draft copy — rewrite freely,
  // nothing else on the page depends on the wording.
  heading: "Can you tell a generated terrain image from a real one?",

  // Each entry becomes one paragraph on the intro page, in order.
  // Feel free to add, remove, or rewrite these — nothing else on the
  // page depends on how many there are.
intro_paragraphs: [
"Hello, and thank you for taking part! I trained a diffusion model (AI image " +
"generation model) to edit Digital Terrain Models by adding retention " +
"basins. We would like to know whether the results look natural or real.",
"You will see 48 images across the next five pages. Some are real and some " +
'are AI-generated. For each image, choose "Real", "AI-generated", or ' +
'"Not Sure". There are no wrong answers, so go with your best judgement."',
"Digital Terrain Models (DTMs) show the elevation of terrain from above. " +
"Darker areas are lower and brighter areas are higher. The images contain " +
"a retention basin exactly in the center of the image, which should appear " +
"as a darker patch. Look closely at the center and check whether the shape " +
"looks natural. Since DTMs are black and white, any colour may also be a clue.",
"It may help to increase the brightness of your screen before starting, " +
"especially when looking for subtle differences.",
"Have fun, and feel free to share the test with others! You can leave at any " +
"point and resume later using your code. The images were hashed, so I do not " +
"know which ones are real either. If you want to know how well you performed, " +
"email me at [andrew.ibrahim@tum.de](mailto:andrew.ibrahim@tum.de) with your code."
],


  // Two labeled examples on the intro page, NOT part of the 48 trials.
  // Replace these two files under study/images/examples/ and update the
  // paths here if you rename them.
  example_real: {
    src: "images/examples/real-example.png",
    caption: "Example — real image",
  },
  example_ai: {
    src: "images/examples/ai-example.png",
    caption: "Example — AI-generated image",
  },

  start_button: "Start experiment",

  completion_heading: "Thank you",
  completion_body:
    "That's the full set — thank you for taking part. Your answers have " +
    "been recorded.",
};
