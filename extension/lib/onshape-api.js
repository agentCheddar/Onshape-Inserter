// Onshape REST API calls made with the signed-in browser session, the same way
// the Onshape API Explorer does it. Session calls don't count toward Onshape's
// annual API call limits (https://onshape-public.github.io/docs/auth/limits/).
(function (root) {
  const BASE = '/api/v12';
  const JSON_TYPE = 'application/json;charset=UTF-8; qs=0.09';

  class ApiError extends Error {
    constructor(status, method, path, body) {
      let detail = body;
      try {
        detail = JSON.parse(body).message || body;
      } catch (_) {}
      super(`Onshape API ${method} ${path} failed (${status}): ${String(detail).slice(0, 300)}`);
      this.status = status;
    }
  }

  // Onshape requires the XSRF cookie(s) to be echoed as headers on writes.
  // This mirrors the request interceptor in Onshape's own API Explorer.
  function xsrfHeaders() {
    const headers = {};
    for (const m of document.cookie.matchAll(/(?:^|;\s*)(XSRF-TOKEN-?\d*)=([^;]+)/g)) {
      headers[`X-${m[1]}`] = m[2];
    }
    return headers;
  }

  async function request(method, path, { query, body } = {}) {
    const url = new URL(BASE + path, location.origin);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers = { Accept: JSON_TYPE, ...xsrfHeaders() };
    if (body !== undefined) headers['Content-Type'] = JSON_TYPE;
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, method, path, text);
    return text ? JSON.parse(text) : null;
  }

  const e = encodeURIComponent;
  const wvmPath = (r) => `/d/${r.did}/${r.wvm}/${r.wvmid}/e/${r.eid}`;
  const asmPath = (doc) => `/assemblies/d/${doc.did}/w/${doc.wid}/e/${doc.eid}`;

  root.FRCI = root.FRCI || {};
  root.FRCI.ApiError = ApiError;
  root.FRCI.api = {
    request,

    assemblyDefinition: (doc) =>
      request('GET', asmPath(doc), {
        query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: false },
      }),

    partBodyDetails: (ref, partId, configuration, linkDocumentId) =>
      request('GET', `/parts${wvmPath(ref)}/partid/${e(partId)}/bodydetails`, {
        query: { configuration, linkDocumentId, includeGeometricData: true },
      }),

    parts: (ref, configuration, linkDocumentId) =>
      request('GET', `/parts${wvmPath(ref)}`, { query: { configuration, linkDocumentId, withThumbnails: false } }),

    versions: (did) => request('GET', `/documents/d/${did}/versions`),

    configuration: (ref) => request('GET', `/elements${wvmPath(ref)}/configuration`),

    encodeConfiguration: (did, eid, parameters, versionId) =>
      request('POST', `/elements/d/${did}/e/${eid}/configurationencodings`, {
        query: { versionId },
        body: { parameters },
      }),

    createInstance: (doc, body) => request('POST', `${asmPath(doc)}/instances`, { body }),

    transformOccurrences: (doc, paths, transform) =>
      request('POST', `${asmPath(doc)}/occurrencetransforms`, {
        body: { occurrences: paths.map((path) => ({ path })), transform, isRelative: false },
      }),

    addFeature: (doc, feature) => request('POST', `${asmPath(doc)}/features`, { body: { feature } }),

    updateFeature: (doc, featureId, feature) =>
      request('POST', `${asmPath(doc)}/features/featureid/${e(featureId)}`, { body: { feature } }),

    deleteFeature: (doc, featureId) => request('DELETE', `${asmPath(doc)}/features/featureid/${e(featureId)}`),
  };
})(globalThis);
