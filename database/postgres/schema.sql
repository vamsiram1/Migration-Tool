DROP TABLE IF EXISTS student_master;

CREATE TABLE student_master
(
    id SERIAL PRIMARY KEY,

    given_name VARCHAR(50),

    family_name VARCHAR(50),

    gender VARCHAR(10),

    date_of_birth DATE,

    phone_number VARCHAR(20),

    email_address VARCHAR(100),

    residential_address VARCHAR(200),

    class_ref VARCHAR(20),

    joined_on DATE
);
