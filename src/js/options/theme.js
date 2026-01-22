export default async function saveOptionTheme() {
  const selectedTheme = document.querySelector(
    'input[name="theme"]:checked',
  ).value;

  await browser.storage.sync.set({
    theme: selectedTheme,
  });
}
