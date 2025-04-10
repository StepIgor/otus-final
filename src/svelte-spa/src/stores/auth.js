import { writable } from "svelte/store";

export const accessToken = writable(null);
export const userLogin = writable(null);
export const userRoleName = writable(null);
