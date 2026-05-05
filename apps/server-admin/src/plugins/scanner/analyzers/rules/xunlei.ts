import { AnalyzerRule } from "../../types";

export const xunleiRule: AnalyzerRule = {
  name: "xunlei",
  label: '迅雷',
  rule: {
    path: '/xunlei',
    rewrite_html: true,
    use_auth: true,
    use_root_mode: false,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>迅雷下载</title>");
  },
};