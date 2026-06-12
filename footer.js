const DEFAULT_DESCRIPTION = "Returns the value of π and related utilities";

async function loadMeta() {
  try {
    const response = await fetch("meta.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load meta.json: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(error);
    return null;
  }
}

function renderMainFunctions(description) {
  if (!description) {
    description = DEFAULT_DESCRIPTION;
  }

  const sectionId = "main-functions";
  const container = document.getElementById("page-footer") || document.body;
  let existing = document.getElementById(sectionId);
  if (existing && existing.parentElement !== container) {
    existing.remove();
    existing = null;
  }

  if (existing) {
    existing.remove();
  }

  const section = document.createElement("section");
  section.id = sectionId;

  const heading = document.createElement("h2");
  heading.textContent = "Main Functions";
  section.appendChild(heading);

  const article = document.createElement("article");
  const title = document.createElement("h3");
  title.textContent = "pigreco()";
  const paragraph = document.createElement("p");
  paragraph.textContent = description;

  article.appendChild(title);
  article.appendChild(paragraph);
  section.appendChild(article);

  container.appendChild(section);
}

async function initFooter() {
  const meta = await loadMeta();
  const description =
    meta &&
    meta.main_functions &&
    typeof meta.main_functions.pigreco === "string"
      ? meta.main_functions.pigreco
      : DEFAULT_DESCRIPTION;
  renderMainFunctions(description);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFooter);
} else {
  initFooter();
}
