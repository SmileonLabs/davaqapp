/* Only the app parent may supply data. No user-supplied HTML is interpreted. */
(function () {
  const channel = "davaq-map-v1";
  const send = (data) => {
    const msg = { channel, ...data };
    if (window.ReactNativeWebView)
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else window.parent.postMessage(msg, location.origin);
  };
  const valid = (p) =>
    p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 85 &&
    Math.abs(p.lng) <= 180;
  const map = L.map("map", {
    center: [37.57, 126.98],
    zoom: 13,
    minZoom: 3,
    maxZoom: 18,
    scrollWheelZoom: false,
  });
  const group = L.layerGroup().addTo(map);
  let tile = null,
    tileUrl = "",
    centerKey = "",
    pickable = false,
    attributionNode = null,
    markersKey = "",
    markerEntries = [];
  map.attributionControl.setPrefix(false);
  map.on("moveend", () => {
    const p = map.getCenter();
    send({
      type: "moved",
      lat: p.lat,
      lng: ((((p.lng + 180) % 360) + 360) % 360) - 180,
    });
  });
  map.on("click", (e) => {
    if (pickable)
      send({
        type: "pick",
        lat: e.latlng.lat,
        lng: ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180,
      });
  });
  function receive(data) {
    if (data?.channel === channel && data.type === "hello") {
      send({ type: "ready" });
      return;
    }
    if (
      data?.channel !== channel ||
      data.type !== "render" ||
      !valid(data.center)
    )
      return;
    pickable = !!data.pickable;
    if (
      typeof data.tileUrl === "string" &&
      data.tileUrl.startsWith("https://") &&
      data.tileUrl !== tileUrl
    ) {
      tileUrl = data.tileUrl;
      if (tile) map.removeLayer(tile);
      tile = L.tileLayer(tileUrl, {
        maxZoom: 18,
        keepBuffer: 1,
        updateWhenIdle: true,
      }).addTo(map);
      tile.on("tileerror", () => {
        document.getElementById("notice").style.display = "block";
      });
      tile.on("tileload", () => {
        document.getElementById("notice").style.display = "none";
      });
      if (attributionNode) attributionNode.remove();
      attributionNode = document.createElement("a");
      attributionNode.href = "https://www.openstreetmap.org/copyright";
      attributionNode.target = "_blank";
      attributionNode.rel = "noopener noreferrer";
      attributionNode.textContent =
        typeof data.attribution === "string"
          ? data.attribution
          : "© OpenStreetMap contributors";
      map.attributionControl.getContainer().append(attributionNode);
    }
    const key =
      data.center.lat +
      "," +
      data.center.lng +
      "," +
      (data.focusToken ?? "") +
      "," +
      (data.zoom || 13);
    if (key !== centerKey) {
      centerKey = key;
      map.setView([data.center.lat, data.center.lng], data.zoom || 13, {
        animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    }
    const nextMarkersKey = JSON.stringify(data.markers);
    if (nextMarkersKey === markersKey) {
      for (const entry of markerEntries)
        entry.marker
          .getElement()
          ?.classList.toggle("selected", entry.ids.includes(data.selectedId));
      map.invalidateSize();
      return;
    }
    markersKey = nextMarkersKey;
    markerEntries = [];
    group.clearLayers();
    const grouped = new Map();
    for (const p of (Array.isArray(data.markers) ? data.markers : []).slice(
      0,
      100,
    )) {
      if (!valid(p) || typeof p.id !== "string") continue;
      const k = p.lat.toFixed(5) + "," + p.lng.toFixed(5);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(p);
    }
    let n = 0;
    for (const values of grouped.values()) {
      const p = values[0],
        selected = values.some((v) => v.id === data.selectedId);
      n++;
      if (values.some((v) => v.precision === "area"))
        L.circle([p.lat, p.lng], {
          radius: 650,
          color: "#8c77de",
          weight: 1,
          fillColor: "#b8a4fc",
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(group);
      const marker = L.marker([p.lat, p.lng], {
        title:
          values.length > 1
            ? values.length + "개 교환"
            : String(p.title || "선택한 장소"),
        icon: L.divIcon({
          className: "pin" + (selected ? " selected" : ""),
          html: values.length > 1 ? String(values.length) : String(n),
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      }).addTo(group);
      const contents = document.createElement("div");
      for (const v of values) {
        const b = document.createElement("button");
        b.textContent = String(v.title || "선택한 장소");
        b.onclick = () => send({ type: "select", id: v.id });
        contents.append(b);
      }
      markerEntries.push({ marker, ids: values.map((v) => v.id) });
      marker.bindPopup(contents);
      marker.on("click", () => send({ type: "select", id: p.id }));
    }
    map.invalidateSize();
  }
  window.DavaqMap = { receive };
  window.addEventListener("message", (e) => {
    if (e.source === window.parent && e.origin === location.origin)
      receive(e.data);
  });
  new ResizeObserver(() => map.invalidateSize()).observe(
    document.getElementById("map"),
  );
  send({ type: "ready" });
})();
