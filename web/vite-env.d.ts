/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Development only: the API key, from .env.development.local. */
  readonly VITE_DEV_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
