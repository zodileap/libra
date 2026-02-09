package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type License struct {
	entity.Database
	ActivationCode   *ActivationCodeEntity
	ActivationRecord *ActivationRecordEntity
}

func (d *License) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "license",
		Tag:  "license",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_activation_code_last_at", Table: "activation_code", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_activation_record_last_at", Table: "activation_record", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *License) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
