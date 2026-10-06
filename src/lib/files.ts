/** Trigger a browser download of `text` as a file named `filename`. */
export const downloadTextFile = (filename: string, text: string, mimeType: string): void => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Open the file picker and read the chosen file as text. Resolves to null
 * when the writer cancels.
 */
export const pickTextFile = (accept: string): Promise<{ name: string; text: string } | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;

    input.addEventListener("change", () => {
      const file = input.files?.[0];

      if (file === undefined) {
        resolve(null);

        return;
      }

      file
        .text()
        .then((text) => resolve({ name: file.name, text }))
        .catch(() => resolve(null));
    });

    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });

/** Turn a document title into a safe filename stem. */
export const filenameStem = (title: string): string => {
  const stem = title
    .trim()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase();

  return stem.length > 0 ? stem : "untitled";
};
