import { AnalyzerRule } from "../../types";

export const jellyfinRule: AnalyzerRule = {
  name: "Jellyfin",
  label: 'Jellyfin',
  rule: {
    path: '/jellyfin',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>Jellyfin</title>");
  },
};