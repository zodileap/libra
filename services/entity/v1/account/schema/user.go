package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type UserEntity struct {
	entity.Entity
	Id        *zspecs.UserIdE    `json:"id"`
	Name      *zspecs.UserNameE  `json:"name"`
	Email     *zspecs.EmailE     `json:"email"`
	Phone     *zspecs.PhoneE     `json:"phone"`
	Password  *zspecs.PasswordE  `json:"password"`
	Status    *zspecs.StatusE    `json:"status"`
	CreatedAt *zspecs.CreatedAtE `json:"created_at"`
	LastAt    *zspecs.LastAtE    `json:"last_at"`
	DeletedAt *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *UserEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "user_info", Comment: "平台用户"}
}

func (e *UserEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Comment("用户唯一标识"),
		e.Name.Name("name").MaxLen(255).Required().Comment("用户名称"),
		e.Email.Name("email").MaxLen(255).Comment("邮箱"),
		e.Phone.Name("phone").MaxLen(32).Comment("手机号"),
		e.Password.Name("password").MaxLen(255).Comment("登录密码"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
