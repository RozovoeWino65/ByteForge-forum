CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(40) PRIMARY KEY,
    username VARCHAR_IGNORECASE(24) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(24) PRIMARY KEY, title VARCHAR(80) NOT NULL,
    description VARCHAR(200) NOT NULL, position INT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(140) NOT NULL, body VARCHAR(3000) NOT NULL,
    category_id VARCHAR(24) NOT NULL REFERENCES categories(id),
    author_id VARCHAR(40) NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_category ON posts(category_id);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(40) NOT NULL REFERENCES users(id)
);
MERGE INTO categories (id,title,description,position) KEY(id) VALUES
('general','Общее','Знакомства, правила, объявления',1),
('tech','Технологии','Код, инструменты, железо',2),
('study','Учёба','Проекты, дедлайны, сессия',3),
('games','Игры','Во что играем и на чём',4),
('offtop','Оффтоп','Всё, что не попало в другие разделы',5);
