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
  "Hello, thank you for taking part! I trained a diffusion model (AI image " +
    "generation model) to edit Digital Terrain Models by adding retention " +
    "basins. To assess the results, we would like to know whether the " +
    'generated results look "natural" or "real", and the best way to find ' +
    "out is to ask humans!",
  "You will see some images in the next five pages. Some of them will be " +
    "real, and some of them will be edited by the model. Your task is to " +
    "decide whether these images are real or generated. There are 48 images " +
    'in total. For each one, you can choose "Real", "AI-generated", or "Not ' +
    'Sure". There are no wrong answers, just go with your best judgement.',
  "To hone this judgement, let me briefly explain what you will be looking " +
    "at in a few moments. Digital Terrain Models (DTMs) model the elevation " +
    "of the terrain in a certain area. Think of the picture as taken from " +
    "the sky facing the ground. The elevation is then stored in the pixel " +
    "value (brightness, or how white the pixel is). This means that darker " +
    "areas are lower and brighter areas are higher.",
  "A slope would look like a gradient, with the picture getting brighter " +
    "the farther up the slope. The images you will be shown have a retention " +
    "basin in the center of the image. So try to look at the center and see " +
    "if you can see any colour or unnatural shapes.",
  "Don't forget to have fun, and send this link to others to challenge them " +
    "and help me with my project! You can leave at any point if you do not " +
    "want to continue, and you can resume later with your code." +
  "P.S. I actually hashed them, so I do not know myself, which ones" +
  "are real. If you want to know how well you performed, write me an email" +
  "with your code, and I will let you know. andrew.ibrahim@tum.de",
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
