import { ofetch, type $Fetch } from "ofetch";

/**
 * Shared HTTP client for all app-level requests (everything except
 * VueFinder's own data layer). Auth (Basic credentials / Bearer token
 * injection) hooks in here in one place.
 */
export const http: $Fetch = ofetch.create({});
