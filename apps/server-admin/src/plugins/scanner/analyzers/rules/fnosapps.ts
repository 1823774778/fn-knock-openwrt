import { AnalyzerRule } from "../../types";

export const fnosappsRule: AnalyzerRule = {
  name: "fnOS Apps",
  label: 'fnOS Apps',
  rule: {
    path: '/fnosapps',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>fnOS Apps</title>");
  },
};