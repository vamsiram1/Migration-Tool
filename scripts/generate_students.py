import random
from datetime import date, timedelta

first_names = [
    "Rahul", "Priya", "Arjun", "Sneha", "Vivek",
    "Ananya", "Rohit", "Kiran", "Meera", "Sanjay"
]

last_names = [
    "Sharma", "Reddy", "Patel", "Kumar",
    "Rao", "Singh", "Gupta", "Joshi"
]

classes = [
    "Grade 6",
    "Grade 7",
    "Grade 8",
    "Grade 9",
    "Grade 10"
]

with open("database/mysql/data.sql", "w") as f:

    for i in range(1,1001):

        fname=random.choice(first_names)
        lname=random.choice(last_names)

        gender=random.choice(["Male","Female"])

        dob=date(2008,1,1)+timedelta(days=random.randint(0,2000))

        admission=date(2022,6,1)+timedelta(days=random.randint(0,300))

        mobile=f"98{random.randint(10000000,99999999)}"

        email=f"{fname.lower()}.{lname.lower()}{i}@school.com"

        address=f"Street {random.randint(1,500)}"

        cls=random.choice(classes)

        sql=f"""INSERT INTO students
(first_name,last_name,gender,dob,mobile,email,address,class_name,admission_date)

VALUES
('{fname}','{lname}','{gender}','{dob}','{mobile}','{email}','{address}','{cls}','{admission}');
"""

        f.write(sql)
