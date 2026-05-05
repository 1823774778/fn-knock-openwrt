import { AnalyzerRule } from "../../types";

export const dpanelRule: AnalyzerRule = {
  name: "DPanel",
  label: 'DPanel',
  rule: {
    path: '/dp',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("dpanel/ui");
  },
};