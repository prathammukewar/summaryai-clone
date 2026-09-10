# Summary AI clone

A static recreation of the Summary AI web app's welcome screen, built with plain HTML, CSS, and JavaScript and hosted on GitHub Pages.

Live: https://prathammukewar.github.io/summaryai-clone/

## What's here

- The sign-in screen: testimonial panel on the left, sign-in options on the right, responsive down to phone widths.
- A guest workspace behind the "Start as Guest" button, with a mock recorder and a notes list saved in localStorage.
- Hash routing (`#/home`, `#/app`) like the original Flutter app.

No frameworks, no build step. Open `index.html` in a browser or serve the folder with any static server:

```
python3 -m http.server 8000
```

## Notes

The original is a Flutter app that draws everything to a canvas, so nothing here is copied from its markup. The icons, laurel badge, and avatar are hand-drawn SVGs. Sign-in buttons are placeholders and nothing is sent anywhere.

This is a front-end exercise and isn't affiliated with Summary AI.
