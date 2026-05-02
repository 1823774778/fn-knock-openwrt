export const EXTERNAL_AUTH_PROVIDER_TYPES = [
  "google",
  "microsoft",
  "github",
  "custom_oidc",
] as const;

export type ExternalAuthProviderType =
  (typeof EXTERNAL_AUTH_PROVIDER_TYPES)[number];

export type ExternalAuthProtocol = "oidc" | "oauth2_profile";
export type OIDCProviderTestStatus = "idle" | "success" | "failed";
export type OIDCAuthStateMode = "login" | "bind";

export type OIDCProviderConnectionConfig = {
  client_id: string;
  client_secret: string;
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  emails_endpoint?: string;
  scopes?: string[];
  tenant?: string;
  extra_auth_params?: Record<string, string>;
};

export type OIDCProvider = {
  id: string;
  type: ExternalAuthProviderType;
  protocol: ExternalAuthProtocol;
  name: string;
  enabled: boolean;
  connection_config: OIDCProviderConnectionConfig;
  created_at: string;
  updated_at: string;
  last_test_at?: string;
  last_test_status?: OIDCProviderTestStatus;
  last_error?: string | null;
};

export type OIDCProviderView = Omit<OIDCProvider, "connection_config"> & {
  connection_config_masked: Record<string, unknown>;
  callback_url?: string;
};

export type OIDCProviderCatalogItem = {
  type: ExternalAuthProviderType;
  protocol: ExternalAuthProtocol;
  label: string;
  description: string;
  default_name: string;
  default_scopes: string[];
  required_fields: Array<keyof OIDCProviderConnectionConfig>;
  optional_fields: Array<keyof OIDCProviderConnectionConfig>;
  supports_pkce: boolean;
  supports_discovery: boolean;
};

export type OIDCBinding = {
  id: string;
  provider_id: string;
  provider_type: ExternalAuthProviderType;
  totp_id: string;
  issuer: string;
  subject: string;
  subject_key: string;
  display_name?: string;
  email?: string;
  email_verified?: boolean;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
};

export type OIDCBindingView = OIDCBinding & {
  provider_name?: string;
  totp_name?: string;
};

export type OIDCBindInvite = {
  token_hash: string;
  totp_id: string;
  provider_id?: string;
  created_at: string;
  expires_at: string;
  used_at?: string;
  used_binding_id?: string;
  note?: string;
};

export type OIDCLoginErrorNotice = {
  token_hash: string;
  message: string;
  created_at: string;
  expires_at: string;
};

export type OIDCAuthState = {
  state_hash: string;
  mode: OIDCAuthStateMode;
  provider_id: string;
  redirect_uri?: string;
  invite_token_hash?: string;
  code_verifier?: string;
  nonce?: string;
  remember_me: boolean;
  client_ip?: string;
  created_at: string;
  expires_at: string;
};

export type OIDCDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
};

export type ExternalAuthProfile = {
  issuer: string;
  subject: string;
  display_name?: string;
  email?: string;
  email_verified?: boolean;
  avatar_url?: string;
};

export type OIDCProviderUpsertInput = {
  name?: string;
  type: string;
  enabled?: boolean;
  connection_config?: Record<string, unknown>;
};

export type OIDCProviderUpdateInput = {
  name?: string;
  enabled?: boolean;
  connection_config?: Record<string, unknown>;
};
