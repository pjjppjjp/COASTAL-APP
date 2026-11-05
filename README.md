# COASTAL — GitHub Pages upload package

## Upload on your Mac

1. Download the ZIP and double-click it to extract it. If Safari already extracted it, open that folder.
2. Open the extracted folder. You should see **index.html**, **app.js**, **styles.css**, and the other files beside them.
3. Press **Command+A** inside that folder.
4. Open your GitHub repository and choose **Add file → Upload files**. You can drag the selected files into that upload area, or click **choose your files**, open the same folder in the file picker, and press Command+A there.
5. Complete the upload and commit the changes to your publishing branch.
6. In **Settings → Pages**, set **Source** to **Deploy from a branch**, choose the branch you uploaded to (usually **main**) and **/(root)**, then Save.
7. Use the site link GitHub displays after deployment.

Upload the extracted files themselves. GitHub stores uploaded ZIPs as ZIPs; the app's index.html needs to be directly at the repository root. This package contains only ordinary visible files, with no nested folders to preserve. Keep every filename unchanged and upload all of them together.

This edition replaces the previous self-contained HTML with separate HTML, JavaScript, CSS and image files. It keeps the tested application and its features. No package installation or custom build is needed.

## If dragging into GitHub does not work

Use **Add file → Upload files → choose your files**. In the Mac file picker, open the extracted folder, press Command+A, then Open. This avoids relying on drag-and-drop.

If GitHub displays an error, keep its exact wording or take a screenshot. File permission, branch-protection and repository-rule errors need to be resolved in the repository; repackaging cannot remove those restrictions.

## Optional Git upload from your Mac

Use this only if you already have Git and an authenticated GitHub setup on your Mac. Replace the repository URL with your own. Choose a new local folder name if coastal-publish already exists.

    git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git ~/Desktop/coastal-publish
    open ~/Desktop/coastal-publish

Copy all the extracted COASTAL files into that cloned folder in Finder. Then run:

    cd ~/Desktop/coastal-publish
    git add -- .
    git commit -m "Update COASTAL Pages app"
    git push

Git uses your existing authentication and the repository's normal permissions. If the repository requires a pull request, follow that workflow. Configure Pages to use the uploaded branch and root folder as above.

## Running and data

The live basemap and online place search need internet. Geometric layouts, counts, materials estimates and coordinate exports are calculated in your browser. Saved plans are local to this browser and website address. Species selection records your chosen species; it does not assess a site's ecological suitability. Methods and research references remain in **The science** within the app.

Open the deployed GitHub Pages link to use this version. For local development, serve this folder with a local static server because the separate JavaScript files use ES modules. The earlier OPEN-COASTAL.html package remains the direct-open version.

## Official help

- Uploading files: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- GitHub Pages setup: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Keep the included Leaflet licence and visible map attribution.
