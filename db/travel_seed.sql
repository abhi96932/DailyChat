-- Idempotent VibeMeet Uttarakhand travel seed data
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Rishikesh','rishikesh','Uttarakhand','Dehradun','River town for rafting, cafes, yoga and easy student weekends.','🌊','Easy',500,700,450,300,500,'{2,3,4,5,6,7,8,9,10,11}','[{"name": "Haridwar", "duration": "45 min", "type": "start"}, {"name": "Shivpuri", "duration": "30 min", "type": "activity"}, {"name": "Rishikesh", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['river','adventure','weekend','quiet'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Haridwar','haridwar','Uttarakhand','Haridwar','Gateway city for riverfront walks, temples and nearby weekend trips.','🛕','Easy',200,600,350,250,150,'{1,2,3,4,5,6,7,8,9,10,11,12}','[{"name": "Har Ki Pauri", "duration": "2 hr", "type": "sightseeing"}, {"name": "Kankhal", "duration": "1 hr", "type": "culture"}]'::jsonb,ARRAY['spiritual','weekend','city'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Kanatal','kanatal','Uttarakhand','Tehri Garhwal','Quiet forest and mountain escape suited to student groups.','🌲','Easy',1200,800,400,350,300,'{3,4,5,6,9,10,11}','[{"name": "Dhanaulti", "duration": "1 hr", "type": "stop"}, {"name": "Surkanda Devi", "duration": "2 hr", "type": "trek"}, {"name": "Kanatal", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['mountains','quiet','camping','weekend'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Dhanaulti','dhanaulti','Uttarakhand','Tehri Garhwal','Pine forests, eco parks and a calm alternative to crowded hill stations.','🌲','Easy',1200,800,400,300,250,'{3,4,5,6,9,10,11}','[{"name": "Dhanaulti Eco Park", "duration": "2 hr", "type": "sightseeing"}, {"name": "Surkanda Devi", "duration": "3 hr", "type": "trek"}]'::jsonb,ARRAY['mountains','quiet','weekend'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Tehri','tehri','Uttarakhand','Tehri Garhwal','Lake, adventure sports and scenic road-trip destination.','🏞️','Easy',1000,650,400,350,500,'{3,4,5,6,9,10,11}','[{"name": "Tehri Lake", "duration": "3 hr", "type": "activity"}, {"name": "New Tehri", "duration": "2 hr", "type": "stop"}]'::jsonb,ARRAY['lake','adventure','weekend'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Auli','auli','Uttarakhand','Chamoli','High-altitude ski and mountain destination with dramatic Himalayan views.','❄️','Moderate',1800,1100,500,400,700,'{1,2,3,4,5,10,11,12}','[{"name": "Joshimath", "duration": "1 hr", "type": "base"}, {"name": "Auli", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['mountains','snow','trek'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Munsiyari','munsiyari','Uttarakhand','Pithoragarh','Remote Kumaon mountain destination known for Himalayan views and treks.','🏔️','Moderate',2200,900,450,500,500,'{3,4,5,10,11}','[{"name": "Almora", "duration": "stop", "type": "route"}, {"name": "Bageshwar", "duration": "stop", "type": "route"}, {"name": "Munsiyari", "duration": "2 days", "type": "stay"}]'::jsonb,ARRAY['mountains','trek','quiet','backpacking'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Mukteshwar','mukteshwar','Uttarakhand','Nainital','Forest hills, viewpoints and climbing near Nainital district.','🌄','Easy',1500,850,450,300,300,'{3,4,5,6,9,10,11}','[{"name": "Mukteshwar Temple", "duration": "1 hr", "type": "sightseeing"}, {"name": "Chauli Ki Jali", "duration": "1 hr", "type": "viewpoint"}]'::jsonb,ARRAY['mountains','quiet','photography'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Ranikhet','ranikhet','Uttarakhand','Almora','Pine forests, cantonment roads and relaxed Kumaon scenery.','🌲','Easy',1500,750,400,300,250,'{3,4,5,6,9,10,11}','[{"name": "Chaubatia", "duration": "2 hr", "type": "sightseeing"}, {"name": "Ranikhet", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['mountains','quiet','photography'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Kausani','kausani','Uttarakhand','Bageshwar','Wide Himalayan views and slow-travel destination.','🏔️','Easy',1700,800,400,350,250,'{3,4,5,6,9,10,11}','[{"name": "Baijnath", "duration": "2 hr", "type": "stop"}, {"name": "Kausani", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['mountains','quiet','photography'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Valley of Flowers','valley-of-flowers','Uttarakhand','Chamoli','Seasonal alpine valley trek; plan around opening conditions and local rules.','🌸','Hard',2200,1200,550,500,700,'{7,8,9}','[{"name": "Govindghat", "duration": "base", "type": "route"}, {"name": "Ghangaria", "duration": "1 day", "type": "stay"}, {"name": "Valley of Flowers", "duration": "1 day", "type": "trek"}]'::jsonb,ARRAY['mountains','trek','flowers'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Chakrata','chakrata','Uttarakhand','Dehradun','Forested hill destination with waterfalls, viewpoints and hikes.','🌲','Moderate',1400,800,400,350,350,'{3,4,5,6,9,10,11}','[{"name": "Tiger Falls", "duration": "half day", "type": "trek"}, {"name": "Chakrata", "duration": "1 day", "type": "stay"}]'::jsonb,ARRAY['mountains','trek','quiet'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Jageshwar','jageshwar','Uttarakhand','Almora','Heritage temple cluster surrounded by cedar forests.','🛕','Easy',1700,700,400,300,200,'{3,4,5,6,9,10,11}','[{"name": "Jageshwar Temples", "duration": "3 hr", "type": "culture"}, {"name": "Dandeshwar", "duration": "1 hr", "type": "culture"}]'::jsonb,ARRAY['culture','quiet','photography'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
VALUES('Pithoragarh','pithoragarh','Uttarakhand','Pithoragarh','Gateway to eastern Kumaon and longer mountain journeys.','🏔️','Moderate',2200,700,400,450,250,'{3,4,5,10,11}','[{"name": "Pithoragarh", "duration": "1 day", "type": "base"}, {"name": "Munsiyari", "duration": "route", "type": "extension"}]'::jsonb,ARRAY['mountains','backpacking'])
ON CONFLICT(slug) DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Uttarakhand Travel','uttarakhand-travel','Travel','🏔️','Student travel plans, buddies, routes and safe group trips across Uttarakhand.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Uttarakhand Trekkers','uttarakhand-trekkers','Travel','🥾','Treks, trail preparation and mountain adventures.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Budget Backpackers UK','budget-backpackers-uk','Travel','🎒','Low-cost student travel and smart shared budgets.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Student Trips Uttarakhand','student-trips-uttarakhand','Travel','🎓','Find classmates and students for weekend and semester trips.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Garhwal Explorers','garhwal-explorers','Travel','🌲','Explore Garhwal destinations together.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Kumaon Explorers','kumaon-explorers','Travel','🏔️','Discover Kumaon with fellow students.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Weekend Trips from Haridwar','weekend-haridwar','Local','🚗','Quick trips starting from Haridwar.') ON CONFLICT DO NOTHING;
INSERT INTO groups(name,slug,category,icon,description) VALUES('Backpacking from Dehradun','backpacking-dehradun','Local','🚆','Find people leaving from Dehradun and nearby areas.') ON CONFLICT DO NOTHING;