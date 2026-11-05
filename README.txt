COASTAL — GitHub Pages upload package

UPLOAD
1. Unzip COASTAL_GitHub_Pages.zip.
2. Open the extracted folder. You should see index.html and the assets folder.
3. Press Command+A inside that folder to select every file and the assets folder.
4. In your GitHub repository, choose Add file > Upload files.
5. Drag everything you selected into the upload area, then Commit changes.
6. Open Settings > Pages. Choose Deploy from a branch.
7. Select main and /(root), then Save. Use your actual branch name if it differs.
8. Open the site URL that GitHub Pages shows when deployment completes.

Upload the CONTENTS of the extracted folder to the repository root.
index.html must appear directly at the top level of the repository.
No terminal commands, npm install, build step, or custom GitHub Actions file is required.
No hidden files are required for this package.

HOSTING
The package uses relative file paths and works at both a domain root and a GitHub
project URL such as https://USERNAME.github.io/REPOSITORY/.
Use the hosted HTTPS page. Opening index.html as a local file can block module loading.

NETWORK AND DATA
The interface and calculation source are included. Live satellite/map tiles,
remote location search and Google Fonts require internet access.
Leaflet and Lucide are bundled locally. Saved plans stay in the browser.
Plans saved on the previous hosted site do not automatically transfer to a new
GitHub Pages address. Export Complete plan there, then import under Saved plans here.

CONTENTS
index.html — application entry point
styles.css — visual design and responsive layouts
app.js — interface, map, saved plans, imports and exports
planner.js — structure layout and area calculations
geocoder.js — place search and coordinate handling
evidence.js — species, field checks and research sources
assets/ — poster, mark, local map/icon libraries and their support files
THIRD_PARTY_NOTICES.txt — library licenses and attribution

PLANNING
Counts are calculated from generated geographic positions. Field observations
are entered by the planner; the map does not infer habitat suitability or future
living seagrass coverage. Structure price, spacing, footprint and planting
capacity remain editable planning assumptions.

Official GitHub guidance:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
