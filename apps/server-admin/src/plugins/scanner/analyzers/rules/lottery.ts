import { AnalyzerRule } from "../../types";

export const lotteryRule: AnalyzerRule = {
  name: "cpzs",
  label: '彩票助手',
  rule: {
    path: '/cpzs',
    rewrite_html: false,
    use_auth: true,
    use_root_mode: true,
    strip_path: true,
    target: '',
  },
  isDefault: false,
  match: (result) => {
    return !!result.body && result.body.includes("<title>彩票助手</title>");
  },
};