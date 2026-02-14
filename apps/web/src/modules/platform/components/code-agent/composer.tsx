import { AriButton, AriContainer, AriTypography } from "aries_react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

export function Composer({ value, onChange, onSend }: ComposerProps) {
  return (
    <AriContainer className="web-panel">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入需求，例如：基于 aries_react 生成一个用户管理页面..."
        className="web-form-field textarea"
      />
      <div className="web-inline-row between">
        <AriTypography variant="caption" value="生成时会自动应用右侧资产约束" />
        <AriButton color="primary" label="发送" onClick={onSend} />
      </div>
    </AriContainer>
  );
}
