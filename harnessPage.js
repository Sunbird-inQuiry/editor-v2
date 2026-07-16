/**
 * Standalone test-harness page for server.js — renders the same HTML on
 * every request so env vars (CONTENT_ID, CHANNEL, …) are picked up without
 * a restart, mirroring Vite's __EDITOR_ENV__ injection at dev-start.
 */

export function renderHarnessPage({ contentId, channel, framework, mode, userId }) {
  const context = JSON.stringify({
    authToken:  '',
    userId,
    channel,
    pdata:      { id: 'sunbird.portal', ver: '1.0' },
    env:        'questionset_editor',
    contentId,
    identifier: contentId,
    framework,
  });

  const config = JSON.stringify({
    mode,
    objectType:      'QuestionSet',
    primaryCategory: 'Practice Question Set',
    maxDepth:        3,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QuML Editor – Standalone</title>

  <!-- Resolve React/ReactDOM peer-deps that are external in the dist bundle -->
  <script type="importmap">
  {
    "imports": {
      "react":             "https://esm.sh/react@19.2.7",
      "react/jsx-runtime": "https://esm.sh/react@19.2.7/jsx-runtime",
      "react-dom":         "https://esm.sh/react-dom@19.2.7",
      "react-dom/client":  "https://esm.sh/react-dom@19.2.7/client"
    }
  }
  <\/script>

  <!-- Rubik is self-hosted (dist/style.css's @font-face), no CDN needed -->
  <link rel="stylesheet" href="/style.css" />
  <!-- CKEditor must be on window before the WC initialises -->
  <script src="/ckeditor/ckeditor.js"><\/script>

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { height: 100vh; overflow: hidden; }
    sb-questionset-editor { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="root" style="width:100%;height:100%;"></div>

  <script type="module">
    import { registerQuestionsetEditor } from '/index.js';
    registerQuestionsetEditor();

    // Set props as element PROPERTIES (not string attributes) so React
    // receives parsed objects on the very first render.
    // JSON is valid JS object-literal syntax, so this works without JSON.parse.
    const editor = document.createElement('sb-questionset-editor');
    editor.context = ${context};
    editor.config  = ${config};
    editor.style.cssText = 'display:block;width:100%;height:100%;';
    document.getElementById('root').appendChild(editor);
  <\/script>
</body>
</html>`;
}
