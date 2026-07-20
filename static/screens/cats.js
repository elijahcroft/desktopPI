/* Ambient screen: a few cats pottering about a warm empty room. No data, no
   clock, nothing to read — it's the "just look at this instead" screen. */
registerScreen({
  id: "cats",
  label: "Cats Chilling",

  html: `<div class="cats-room">
           <div class="cats-rug"></div>
           <div class="cats-hint">🐾</div>
         </div>`,

  mount(root, ctx) {
    // Slower than the dashboard cat and no "claimable!" chatter — the whole
    // point of this screen is that nothing is urgent.
    const says = ["mrrp?", "prrr…", "nya~", "*yawn*", "mew", "…", "zzz"];
    const variants = ["orange", "orange", "grey", "white", "grey"];
    cats = variants.map((variant) => createPet(ctx.petLayer, {
      bed: null,                       // nap wherever they happen to be
      speed: 22 + Math.random() * 14,
      says,
      variant,
    }));
  },

  unmount() {
    cats.forEach((c) => c.stop());
    cats = [];
  },
});

let cats = [];
