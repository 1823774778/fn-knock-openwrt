import { formatDateTimeSafe } from "@admin-shared/utils/formatDateTimeSafe";

export const buildDDNSTimestampTooltipLines = (input: {
  updatedAt: string | null | undefined;
  checkedAt: string | null | undefined;
  locale?: string;
}) => {
  const locale = input.locale || "zh-CN";

  return [
    `最后成功更新: ${formatDateTimeSafe(input.updatedAt, {
      locale,
      emptyText: "从未",
    })}`,
    `最后检查: ${formatDateTimeSafe(input.checkedAt, {
      locale,
      emptyText: "从未",
    })}`,
  ];
};
