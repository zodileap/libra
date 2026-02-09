package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type AgentCode struct {
	entity.Database
	FrameworkAsset *FrameworkAssetEntity
	ComponentAsset *ComponentAssetEntity
	ModuleAsset    *ModuleAssetEntity
}

func (d *AgentCode) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "agent_code",
		Tag:  "agentCode",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_framework_asset_last_at", Table: "framework_asset", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_component_asset_last_at", Table: "component_asset", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_module_asset_last_at", Table: "module_asset", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *AgentCode) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
