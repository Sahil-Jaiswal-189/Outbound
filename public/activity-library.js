export async function openActivityLibrary({ el, api, minutes, onChoose, onClose }) {
  const content = el("div", { class: "modal-body" }, el("p", { role: "status" }, "Loading activities..."));
  const modal = el("div", { class: "modal-backdrop" }, el("section", { class: "modal activity-library", role: "dialog", "aria-modal": "true", "aria-label": "Activity library" }, [
    el("header", {}, [el("h2", {}, "Activity library"), el("button", { class: "button ghost", onclick: onClose }, "Close")]), content
  ]));
  document.body.append(modal);
  try {
    const { activities } = await api("/api/activities");
    if (!modal.isConnected) return;
    let page = 0;
    const search = el("input", { type: "search", "aria-label": "Search activities", placeholder: "Search activities" });
    const category = el("select", { "aria-label": "Activity category" }, [
      el("option", { value: "" }, "All categories"), ...["movement", "nature", "curiosity", "creativity", "social", "errand"].map(type =>
        el("option", { value: type }, type[0].toUpperCase() + type.slice(1)))
    ]);
    const fits = el("input", { type: "checkbox", "aria-label": "Within my time" });
    const count = el("p", { class: "library-count", role: "status" });
    const list = el("div", { class: "library-list" });
    const pagination = el("div", { class: "library-pagination" });
    function refresh() {
      const query = search.value.trim().toLowerCase();
      const filtered = activities.filter(a => (!category.value || category.value === a.type)
        && (!fits.checked || a.minMinutes <= minutes)
        && `${a.title} ${a.type} ${a.action} ${a.prep.join(" ")}`.toLowerCase().includes(query));
      const pages = Math.max(1, Math.ceil(filtered.length / 12));
      page = Math.min(page, pages - 1);
      count.textContent = `${filtered.length} of ${activities.length} activities`;
      list.replaceChildren(...filtered.slice(page * 12, (page + 1) * 12).map(a => el("article", { class: `library-item library-${a.type}` }, [
        el("div", { class: "library-item-heading" }, [el("h3", {}, a.title),
          el("button", { class: "button secondary", type: "button", "aria-label": `Choose ${a.title}`, onclick: () => onChoose(a) }, "Choose")]),
        el("p", { class: "library-meta" }, `${a.type} / ${a.minMinutes}-${a.maxMinutes}m / ${a.physical} effort`),
        el("p", {}, a.action),
        a.prep.length ? el("p", { class: "library-prep" }, `Bring: ${a.prep.join(" ")}`) : null,
        a.minMinutes > minutes ? el("p", { class: "library-prep" }, `Needs at least ${a.minMinutes} minutes.`) : null
      ])));
      if (!filtered.length) list.append(el("p", {}, "No activities match."));
      pagination.replaceChildren(
        el("button", { class: "button ghost icon-button", title: "Previous activities", "aria-label": "Previous activities", disabled: page === 0 || undefined,
          onclick: () => { page--; refresh(); list.scrollIntoView({ block: "start" }); } }, el("i", { "data-lucide": "chevron-left" })),
        el("span", {}, `${page + 1} / ${pages}`),
        el("button", { class: "button ghost icon-button", title: "Next activities", "aria-label": "Next activities", disabled: page === pages - 1 || undefined,
          onclick: () => { page++; refresh(); list.scrollIntoView({ block: "start" }); } }, el("i", { "data-lucide": "chevron-right" }))
      );
      window.lucide?.createIcons();
    }
    for (const input of [search, category, fits]) input.addEventListener(input === search ? "input" : "change", () => { page = 0; refresh(); });
    content.replaceChildren(el("div", { class: "library-toolbar" }, [search, category,
      el("label", { class: "library-time-filter" }, [fits, "Within my time"])]), count, list, pagination);
    refresh(); search.focus();
  } catch (error) {
    content.replaceChildren(el("p", { role: "alert" }, error.message),
      el("button", { class: "button secondary", onclick: onClose }, "Close library"));
  }
}
