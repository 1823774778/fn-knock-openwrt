import { AnalyzerRule } from "../../types";

export const mefrpRule: AnalyzerRule = {
  name: "ME Frp",
  label: 'ME Frp',
  rule: {
    path: '/mefrp',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>WebUI 登录 | ME Frp</title>");
  },
};