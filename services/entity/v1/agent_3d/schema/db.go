package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type Agent3D struct {
	entity.Database
	ModelTask   *ModelTaskEntity
	ModelResult *ModelResultEntity
	DccBinding  *DccBindingEntity
}

func (d *Agent3D) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "agent_3d",
		Tag:  "agent3d",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_model_task_last_at", Table: "model_task", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_model_result_last_at", Table: "model_result", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_dcc_binding_last_at", Table: "dcc_binding", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *Agent3D) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
