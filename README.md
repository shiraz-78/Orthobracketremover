# Orthobracketremover (Virtual Debond)

Detects orthodontic brackets on a post-treatment intraoral STL, removes them together with the cement flash, rebuilds the enamel underneath, and exports a clean STL that a retainer can be made on. Everything runs in the browser; no server, no upload.

Open `index.html` in Chrome (or any current browser). The sample pair loads on start so the whole flow can be seen before loading a real scan.

## Workflow

1. **Load scans.** The post-ortho STL (with the brackets) is all that's needed. Adding the pre-ortho STL is optional and improves both detection and the rebuilt surface.
2. **Check the brackets.** Detection runs automatically. Red parts will be removed; amber parts were considered and rejected (each with a reason). Click any part to include or exclude it, click a missed bracket to grab it from that point, or use the add/erase brushes. The ring taken around each bracket for cement is a live slider.
3. **Remove and rebuild.** One click. After the rebuild a second automatic look picks up small remnants (hook bases, wing tips, cement blobs) beside the rebuilt areas and offers them for removal.
4. **Export** the binary STL (same units and orientation as the input).

## How it works

- **Reference tooth surface.** The scan is binned into 0.4 mm cells and diffused along the surface over ~2.5 mm, giving a smooth "tooth without hardware" reference that is independent of triangle size. Each point gets a height above that reference and a steepness relative to it.
- **Bracket detection.** Steep walls standing above the reference on facial surfaces are found, the small surface islands they enclose (wing tops, slot floor) are filled in, and the result is grown briefly through clearly raised surface. Connected parts are scored: facial (facing out of the arch, judged on the reference normal), bracket-sized, 0.9–1.7 mm proud, not sitting on a thin edge. Small raised specks beside an accepted bracket (hooks, wing tips) are merged into it.
- **Removal region.** The bracket plus a ring measured in the plane of the tooth surface from the bracket's footprint (default 0.8 mm), so the base pad and flash under 1.5 mm-tall wings are included; beyond the first millimetre the ring stops at concave creases (sulcus, embrasures).
- **Hole filling.** Each hole outline is ear-clipped (self-touching outlines are split), remeshed to the scan's own triangle size, and faired by solving the biharmonic equation with the rim and the ring outside it fixed, blended 70/30 with a membrane solution (which tracks convex crowns best). Tangential relaxation and quality-driven edge flips remove rim slivers.
- **Pre-ortho scan, when present.** The arches are aligned (PCA plus trimmed point-to-plane ICP), then each bracketed tooth's facial enamel is rigidly fitted to the pre scan from several starting poses, scored on the annulus around the bracket. Bracket height above the fitted anatomy confirms or rejects candidates; the rebuilt patch is projected onto the fitted pre surface with a harmonic correction so it meets the rim exactly. Holes whose rim disagrees with the pre scan (a deciduous tooth replaced, a reshaped crown) fall back to the enamel-only rebuild.

All thresholds are under *Advanced settings*. Measured on a real pair, the rebuilt enamel sits within a median 0.02 mm (mean 0.08 mm) of the pre-treatment surface when the pre scan guides the fill, and a median 0.06 mm (mean 0.14 mm) from the surrounding enamel alone.

## Notes

- Export inside claude.ai arrives as a `.zip` holding the STL; the local file saves the `.stl` directly.
- Libraries: three.js r128 (viewer only). All geometry processing is in `index.html`.
