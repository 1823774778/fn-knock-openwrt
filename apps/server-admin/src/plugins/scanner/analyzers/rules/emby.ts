import { AnalyzerRule } from "../../types";

export const embyRule: AnalyzerRule = {
  name: "Emby",
  label: 'Emby',
  rule: {
    path: '/emby',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("emby-elements/emby-collapse/emby-collapse");
  },
};