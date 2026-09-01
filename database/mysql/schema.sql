DROP TABLE IF EXISTS students;

CREATE TABLE students
(
    student_id INT AUTO_INCREMENT PRIMARY KEY,

    first_name VARCHAR(50),

    last_name VARCHAR(50),

    gender VARCHAR(10),

    dob DATE,

    mobile VARCHAR(20),

    email VARCHAR(100),

    address VARCHAR(200),

    class_name VARCHAR(20),

    admission_date DATE
);
