// Sample dataset, valid on both PostgreSQL and MySQL.
export const SAMPLE_STATEMENTS = [
  'DROP TABLE IF EXISTS employees',
  'DROP TABLE IF EXISTS departments',
  'CREATE TABLE departments (id INT PRIMARY KEY, name VARCHAR(50) NOT NULL)',
  `CREATE TABLE employees (
    id INT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    dept_id INT,
    salary INT NOT NULL,
    hire_date DATE NOT NULL
  )`,
  `INSERT INTO departments (id, name) VALUES
    (1, 'Engineering'), (2, 'Sales'), (3, 'HR'), (4, 'Finance')`,
  `INSERT INTO employees (id, name, dept_id, salary, hire_date) VALUES
    (1, 'Asha', 1, 120000, '2021-03-15'),
    (2, 'Ben', 1, 95000, '2022-07-01'),
    (3, 'Chitra', 2, 70000, '2020-01-20'),
    (4, 'Dev', 2, 65000, '2023-02-11'),
    (5, 'Esha', 3, 60000, '2019-09-30'),
    (6, 'Farhan', 1, 135000, '2018-05-05'),
    (7, 'Gita', 4, 88000, '2021-11-12'),
    (8, 'Hari', NULL, 50000, '2024-01-08')`,
];
