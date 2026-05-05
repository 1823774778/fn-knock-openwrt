import { AnalyzerRule } from "../../types";

export const moontvRule: AnalyzerRule = {
  name: "MoonTV",
  label: 'MoonTV',
  rule: {
    path: '/moontv',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>MoonTV</title>");
  },
};