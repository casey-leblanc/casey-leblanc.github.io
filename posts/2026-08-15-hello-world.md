---
title: test 
date: 2026-08-15
---
This is the very first blog entry. I got inspired by geaux engineering and I thought it would be nice to have a website of my own, then I realized I should include a blog because all of the cool kids have one.

I'll be trying to implement everything without using frameworks or templates, because i think it will help my web development skills

My blog implementation is based off of this reddit thread where they talked about using markdown files to populate their blog. I did much the same. My code iterates through all of my posts (based on a manually filled out json file of all of my posts), then parses the markdown file and converts it into HTML. It creates each part of the blog post container and then uses the converted markdown file as the inner content. 

I don't actually know if it's scalable, but this is all a learning excercise for now.
