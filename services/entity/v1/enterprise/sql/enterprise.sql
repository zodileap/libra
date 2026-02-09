
/*
    Server Type: PostgreSQL
    Catalogs: enterprise
    Schema: public
*/

-- ********
-- EXTENSION
-- ********
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ********
-- Delete Foreign Key
-- ********
DO $$
BEGIN

END
$$;


-- ********
-- Sequence enterprise_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".enterprise_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."enterprise_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".enterprise_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".enterprise_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".enterprise_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "enterprise"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."enterprise" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'enterprise' 
        LOOP
            IF column_rec.column_name NOT IN ('id','code','name','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."enterprise" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "id" int8 NOT NULL DEFAULT enterprise_id_seq();
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "id" SET DEFAULT enterprise_id_seq(); ALTER TABLE "public"."enterprise" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'code' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "code" SET NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "code" DROP DEFAULT; ALTER TABLE "public"."enterprise" ALTER COLUMN "code" TYPE varchar(128) USING "code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."enterprise" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."enterprise" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."enterprise" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."enterprise" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."enterprise" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."enterprise" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'enterprise'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."enterprise" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."enterprise" (
            "id" int8 NOT NULL DEFAULT enterprise_id_seq(),
            "code" varchar(128) NOT NULL,
            "name" varchar(255) NOT NULL,
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."enterprise"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."enterprise"."code" IS  '企业编码';
    COMMENT ON COLUMN "public"."enterprise"."name" IS  '企业名称';
    COMMENT ON COLUMN "public"."enterprise"."status" IS  '状态';
    COMMENT ON COLUMN "public"."enterprise"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."enterprise"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."enterprise"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."enterprise"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."enterprise" IS '企业信息';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."enterprise" ADD CONSTRAINT enterprise_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence enterprise_member_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".enterprise_member_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."enterprise_member_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".enterprise_member_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".enterprise_member_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".enterprise_member_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "enterprise_member"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise_member') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_member'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."enterprise_member" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'enterprise_member' 
        LOOP
            IF column_rec.column_name NOT IN ('id','enterprise_id','user_id','role_code','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."enterprise_member" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "id" int8 NOT NULL DEFAULT enterprise_member_id_seq();
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "id" SET DEFAULT enterprise_member_id_seq(); ALTER TABLE "public"."enterprise_member" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'enterprise_id' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "enterprise_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "enterprise_id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "enterprise_id" DROP DEFAULT; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "enterprise_id" TYPE int8 USING "enterprise_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'role_code' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "role_code" varchar(128);
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "role_code" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "role_code" DROP DEFAULT; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "role_code" TYPE varchar(128) USING "role_code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_member' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."enterprise_member" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_member" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."enterprise_member" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_member'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."enterprise_member" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'enterprise_member'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."enterprise_member" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."enterprise_member" (
            "id" int8 NOT NULL DEFAULT enterprise_member_id_seq(),
            "enterprise_id" int8 NOT NULL,
            "user_id" uuid NOT NULL,
            "role_code" varchar(128),
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."enterprise_member"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."enterprise_member"."enterprise_id" IS  '企业Id';
    COMMENT ON COLUMN "public"."enterprise_member"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."enterprise_member"."role_code" IS  '角色编码';
    COMMENT ON COLUMN "public"."enterprise_member"."status" IS  '状态';
    COMMENT ON COLUMN "public"."enterprise_member"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."enterprise_member"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."enterprise_member"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."enterprise_member" IS '企业成员';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_member'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."enterprise_member" ADD CONSTRAINT enterprise_member_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence enterprise_role_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".enterprise_role_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."enterprise_role_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".enterprise_role_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".enterprise_role_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".enterprise_role_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "enterprise_role"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise_role') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_role'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."enterprise_role" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'enterprise_role' 
        LOOP
            IF column_rec.column_name NOT IN ('id','enterprise_id','code','name','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."enterprise_role" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "id" int8 NOT NULL DEFAULT enterprise_role_id_seq();
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "id" SET DEFAULT enterprise_role_id_seq(); ALTER TABLE "public"."enterprise_role" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'enterprise_id' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "enterprise_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "enterprise_id" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "enterprise_id" DROP DEFAULT; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "enterprise_id" TYPE int8 USING "enterprise_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'code' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "code" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "code" DROP DEFAULT; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "code" TYPE varchar(128) USING "code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enterprise_role' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."enterprise_role" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."enterprise_role" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."enterprise_role" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_role'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."enterprise_role" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'enterprise_role'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."enterprise_role" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."enterprise_role" (
            "id" int8 NOT NULL DEFAULT enterprise_role_id_seq(),
            "enterprise_id" int8 NOT NULL,
            "code" varchar(128) NOT NULL,
            "name" varchar(255) NOT NULL,
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."enterprise_role"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."enterprise_role"."enterprise_id" IS  '企业Id';
    COMMENT ON COLUMN "public"."enterprise_role"."code" IS  '角色编码';
    COMMENT ON COLUMN "public"."enterprise_role"."name" IS  '角色名称';
    COMMENT ON COLUMN "public"."enterprise_role"."status" IS  '状态';
    COMMENT ON COLUMN "public"."enterprise_role"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."enterprise_role"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."enterprise_role"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."enterprise_role"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."enterprise_role" IS '企业角色';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'enterprise_role'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."enterprise_role" ADD CONSTRAINT enterprise_role_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;





-- ********
-- Add Foreign Key
-- ********
DO $$
BEGIN

END
$$;

-- ********
-- Create Triggers
-- ********

DO $$
DECLARE
    trigger_rec RECORD;
    func_rec RECORD; 
BEGIN
    -- 删除所有存在的触发器和关联函数
    FOR trigger_rec IN (
        SELECT tgname as trigger_name, 
               tgrelid::regclass as table_name,
               p.proname as function_name
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    ) LOOP
        -- 删除触发器
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(trigger_rec.trigger_name) || 
                ' ON ' || trigger_rec.table_name;
        -- 删除关联的触发器函数 
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(trigger_rec.function_name) || '()';
    END LOOP;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_enterprise_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_enterprise_last_at') || '"
                BEFORE UPDATE ON "public"."enterprise"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_enterprise_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise_member') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_enterprise_member_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_enterprise_member_last_at') || '"
                BEFORE UPDATE ON "public"."enterprise_member"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_enterprise_member_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprise_role') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_enterprise_role_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_enterprise_role_last_at') || '"
                BEFORE UPDATE ON "public"."enterprise_role"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_enterprise_role_last_at_trigger_func"()';
    END IF;
END;
$$;


