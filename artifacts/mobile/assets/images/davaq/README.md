# DAVAQ branding

`queue.png` is the approved black background / white DAVAQ wordmark.
Native OS launch screens, authentication/routing loading screens and PWA boot screens use this same mark at 240 logical pixels on black. There is no separate startup animation or white loading panel.

Run `node scripts/export-davaq-icons.cjs` to regenerate monochrome native, PWA and favicon exports from this asset. The previous purple Q mark must not be regenerated.
Android adaptive and monochrome launchers use `brand-foreground.png` (transparent white wordmark) on black.
The dated favicon filename invalidates cached legacy browser icons.
